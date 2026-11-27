const API_BASE = 'https://discord.com/api/v10'
const CATCH_ALL_ROLE_NAME = 'All Posts'

export type AnnouncementPost = {
  title: string
  /** Relative Reddit permalink, e.g. "/r/sub/comments/abc123/title/". */
  permalink: string
  /** The submission's link target (equals the permalink for self posts). */
  url: string
  flairText: string | undefined
  authorName: string
}

type DiscordRole = {id: string; name: string}
type DiscordMessage = {id: string}

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
