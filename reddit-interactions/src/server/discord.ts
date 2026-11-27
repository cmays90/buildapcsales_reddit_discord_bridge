const API_BASE = 'https://discord.com/api/v10'
export const CATCH_ALL_ROLE_NAME = 'All Posts'

/**
 * The role-picker select menu's custom_id. Duplicated from the identical
 * constant in discord-interactions/src/interactions.rs — the two sides
 * never share code, per docs/tech-stack.md, so keep them in sync by hand.
 */
export const NOTIFY_CUSTOM_ID = 'notify-roles'

export type AnnouncementPost = {
  title: string
  /** Relative Reddit permalink, e.g. "/r/sub/comments/abc123/title/". */
  permalink: string
  /** The submission's link target (equals the permalink for self posts). */
  url: string
  flairText: string | undefined
  authorName: string
}

export type PickerOption = {label: string; value: string}

type DiscordRole = {id: string; name: string}
type DiscordMessage = {id: string}

type DiscordComponent = {
  type: number
  custom_id?: string
  options?: PickerOption[]
  placeholder?: string
  components?: DiscordComponent[]
}
type DiscordMessageDetail = {components?: DiscordComponent[]}

export type PickerState = {
  options: PickerOption[]
  placeholder: string | undefined
}

/** Reads the flair's Discord role, creating it if this is the flair's first post. */
export async function ensureRoleId(
  guildId: string,
  botToken: string,
  roleName: string,
): Promise<string> {
  const roles = await discordFetch<DiscordRole[]>(
    `/guilds/${guildId}/roles`,
    botToken,
  )
  const existing = roles.find(role => role.name === roleName)
  if (existing) return existing.id

  const created = await discordFetch<DiscordRole>(
    `/guilds/${guildId}/roles`,
    botToken,
    {
      method: 'POST',
      body: JSON.stringify({name: roleName, mentionable: true}),
    },
  )
  return created.id
}

export function sourceDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
}

export function commentsUrl(permalink: string): string {
  return `https://www.reddit.com${permalink}`
}

/**
 * Posts the announcement embed, pinging the flair's role and the opt-in
 * catch-all role, then crossposts it so following servers receive it too.
 */
export async function postAnnouncement(
  guildId: string,
  channelId: string,
  botToken: string,
  post: AnnouncementPost,
): Promise<void> {
  const catchAllRoleId = await ensureRoleId(
    guildId,
    botToken,
    CATCH_ALL_ROLE_NAME,
  )
  const flairRoleId = post.flairText
    ? await ensureRoleId(guildId, botToken, post.flairText)
    : undefined
  const mentionedRoleIds = [flairRoleId, catchAllRoleId].filter(
    (id): id is string => id !== undefined,
  )

  const domain = sourceDomain(post.url)
  const embed = {
    title: post.title,
    url: post.url,
    author: {name: post.authorName},
    fields: domain ? [{name: 'Domain', value: domain, inline: true}] : [],
    description: `[Comments](${commentsUrl(post.permalink)})`,
  }

  const message = await discordFetch<DiscordMessage>(
    `/channels/${channelId}/messages`,
    botToken,
    {
      method: 'POST',
      body: JSON.stringify({
        content: mentionedRoleIds.map(id => `<@&${id}>`).join(' '),
        embeds: [embed],
        allowed_mentions: {roles: mentionedRoleIds},
      }),
    },
  )

  try {
    await discordFetch(
      `/channels/${channelId}/messages/${message.id}/crosspost`,
      botToken,
      {method: 'POST'},
    )
  } catch (err) {
    // Non-critical: the announcement is already posted. A non-Announcement
    // channel, or one nobody follows, will fail here and that's fine.
    console.warn(
      `crosspost failed; ${err instanceof Error ? err.message : err}`,
    )
  }
}

/** Reads the role-picker message's current select-menu options and placeholder. */
export async function getPickerState(
  channelId: string,
  messageId: string,
  botToken: string,
): Promise<PickerState> {
  const message = await discordFetch<DiscordMessageDetail>(
    `/channels/${channelId}/messages/${messageId}`,
    botToken,
  )
  const component = message.components
    ?.flatMap(row => row.components ?? [])
    .find(c => c.custom_id === NOTIFY_CUSTOM_ID)
  return {
    options: component?.options ?? [],
    placeholder: component?.placeholder,
  }
}

/** Replaces the role-picker message's select-menu options, keeping its placeholder. */
export async function updatePickerOptions(
  channelId: string,
  messageId: string,
  botToken: string,
  options: PickerOption[],
  placeholder: string | undefined,
): Promise<void> {
  await discordFetch(`/channels/${channelId}/messages/${messageId}`, botToken, {
    method: 'PATCH',
    body: JSON.stringify({
      components: [
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: NOTIFY_CUSTOM_ID,
              placeholder,
              min_values: 0,
              max_values: options.length,
              options,
            },
          ],
        },
      ],
    }),
  })
}

async function discordFetch<T>(
  path: string,
  botToken: string,
  init?: {method?: string; body?: string},
): Promise<T> {
  const rsp = await fetch(`${API_BASE}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: init?.body,
  })
  if (!rsp.ok) {
    throw new Error(
      `Discord API ${init?.method ?? 'GET'} ${path} -> ${rsp.status}: ${await rsp.text()}`,
    )
  }
  return (await rsp.json()) as T
}
