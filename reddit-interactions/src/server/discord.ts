const API_BASE = 'https://discord.com/api/v10'

/** The picker's label for the always-offered catch-all option. */
export const CATCH_ALL_ROLE_NAME = 'All Posts'

/**
 * The actual Discord role behind the catch-all picker option - an existing
 * role this server already uses for "every post" notifications, not one
 * this app creates. The picker still displays CATCH_ALL_ROLE_NAME as the
 * label; only the underlying role name differs.
 */
export const CATCH_ALL_DISCORD_ROLE_NAME = 'alert:bapcs'

/**
 * This server's existing per-flair roles are named "alert:<slug>" (e.g.
 * "alert:gpu"), not the bare flair text - the picker still displays the
 * bare flair name, this only affects which Discord role gets looked up
 * or created.
 */
const ALERT_ROLE_PREFIX = 'alert:'

/** Maps a Reddit flair's text to the Discord role name it corresponds to. */
export function discordRoleNameForFlair(flairText: string): string {
  const slug = flairText
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${ALERT_ROLE_PREFIX}${slug}`
}

/**
 * The role-picker select menu's custom_id. Duplicated from the identical
 * constant in discord-interactions/src/interactions.rs — the two sides
 * never share code, per docs/tech-stack.md, so keep them in sync by hand.
 */
export const NOTIFY_CUSTOM_ID = 'notify-roles'

/**
 * The server banner shown on the role-picker message. Hardcoded rather than
 * fetched fresh from the guild each time - it's decoration, not something
 * that needs to stay live if the banner changes.
 */
const PICKER_BANNER_URL =
  'https://cdn.discordapp.com/banners/779510278114377738/67c2444b89c5febca0029ecc5651b18d.webp?size=480'

const PICKER_EMBED_DESCRIPTION =
  'Add or remove roles for buildapcsales channel alerts. Adding a role means you will be pinged anytime a new post with that flair is made on the sub.'

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

export class DiscordApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type DiscordRole = {id: string; name: string}
type DiscordMessage = {id: string}

type DiscordComponent = {
  type: number
  custom_id?: string
  options?: PickerOption[]
  placeholder?: string
  min_values?: number
  max_values?: number
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
 * catch-all role, reacts with the server's upvote/downvote emoji, then
 * crossposts it so following servers receive it too.
 */
export async function postAnnouncement(
  guildId: string,
  channelId: string,
  botToken: string,
  upvoteEmoji: string,
  downvoteEmoji: string,
  post: AnnouncementPost,
): Promise<void> {
  const catchAllRoleId = await ensureRoleId(
    guildId,
    botToken,
    CATCH_ALL_DISCORD_ROLE_NAME,
  )
  const flairRoleId = post.flairText
    ? await ensureRoleId(
        guildId,
        botToken,
        discordRoleNameForFlair(post.flairText),
      )
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

  for (const emoji of [upvoteEmoji, downvoteEmoji]) {
    try {
      await addReaction(channelId, message.id, botToken, emoji)
    } catch (err) {
      // Non-critical: a bad/missing emoji shouldn't block the announcement.
      console.warn(
        `failed to react with ${emoji}; ${err instanceof Error ? err.message : err}`,
      )
    }
  }

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

/**
 * Reacts to a message with the given emoji. For a custom emoji, pass
 * "name:id" (e.g. "upvote:795431210360635402") - Discord's own `<name:id>`
 * chat syntax doesn't apply here, this is the raw API identifier.
 */
async function addReaction(
  channelId: string,
  messageId: string,
  botToken: string,
  emoji: string,
): Promise<void> {
  await discordFetch<void>(
    `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
    botToken,
    {method: 'PUT'},
  )
}

/** Builds the role-picker message's embed: the banner image and explainer text. */
export function buildPickerEmbed(): {
  description: string
  image: {url: string}
} {
  return {
    description: PICKER_EMBED_DESCRIPTION,
    image: {url: PICKER_BANNER_URL},
  }
}

/** Builds the role-picker's single string-select row, shared by create and update. */
export function buildPickerComponents(
  options: PickerOption[],
  placeholder: string | undefined,
): DiscordComponent[] {
  return [
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
  ]
}

/**
 * Reads the role-picker message's current select-menu options and
 * placeholder. Returns `undefined` if the message no longer exists (deleted
 * out from under the bot), so the caller can recreate it.
 */
export async function getPickerState(
  channelId: string,
  messageId: string,
  botToken: string,
): Promise<PickerState | undefined> {
  let message: DiscordMessageDetail
  try {
    message = await discordFetch<DiscordMessageDetail>(
      `/channels/${channelId}/messages/${messageId}`,
      botToken,
    )
  } catch (err) {
    if (err instanceof DiscordApiError && err.status === 404) return undefined
    throw err
  }
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
      components: buildPickerComponents(options, placeholder),
    }),
  })
}

/** Posts a new role-picker message with the given options, returning its id. */
export async function createPickerMessage(
  channelId: string,
  botToken: string,
  options: PickerOption[],
  placeholder: string,
): Promise<string> {
  const message = await discordFetch<DiscordMessage>(
    `/channels/${channelId}/messages`,
    botToken,
    {
      method: 'POST',
      body: JSON.stringify({
        embeds: [buildPickerEmbed()],
        components: buildPickerComponents(options, placeholder),
      }),
    },
  )
  return message.id
}

/** Pins a message in its channel. */
export async function pinMessage(
  channelId: string,
  messageId: string,
  botToken: string,
): Promise<void> {
  await discordFetch<void>(
    `/channels/${channelId}/pins/${messageId}`,
    botToken,
    {
      method: 'PUT',
    },
  )
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
    throw new DiscordApiError(
      rsp.status,
      `Discord API ${init?.method ?? 'GET'} ${path} -> ${rsp.status}: ${await rsp.text()}`,
    )
  }
  // Pin/unpin return 204 No Content - nothing to parse.
  if (rsp.status === 204) return undefined as T
  return (await rsp.json()) as T
}
