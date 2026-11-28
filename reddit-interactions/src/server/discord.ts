import {errorDetail, logWarn} from './log.ts'

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

/**
 * Resolves each of `roleNames` to its Discord role id, creating any that
 * don't exist yet (first post/sync under that flair). Fetches the guild's
 * role list once and reuses it for every name, rather than once per name -
 * calling a per-name resolver in a loop or `Promise.all` would GET the
 * entire role list redundantly for each one, multiplying Discord API
 * traffic by the number of roles involved (we saw this trip both Discord's
 * own rate limit and Devvit's outbound-request throttle on a subreddit with
 * many flairs). Returns ids in the same order as `roleNames`.
 */
export async function ensureRoleIds(
  guildId: string,
  botToken: string,
  roleNames: readonly string[],
): Promise<string[]> {
  const roles = await discordFetch<DiscordRole[]>(
    `/guilds/${guildId}/roles`,
    botToken,
  )
  const ids: string[] = []
  for (const roleName of roleNames) {
    const existing = roles.find(role => role.name === roleName)
    if (existing) {
      ids.push(existing.id)
      continue
    }
    const created = await discordFetch<DiscordRole>(
      `/guilds/${guildId}/roles`,
      botToken,
      {
        method: 'POST',
        body: JSON.stringify({name: roleName, mentionable: true}),
      },
    )
    roles.push(created)
    ids.push(created.id)
  }
  return ids
}

export function sourceDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
}

/**
 * Builds the short redd.it link to a post's comments, extracted from its
 * permalink - the format the reference bot used, and shorter than the full
 * /r/<sub>/comments/<id>/<slug>/ url. Falls back to the full reddit.com
 * link if the permalink doesn't look like the expected shape.
 */
export function commentsUrl(permalink: string): string {
  const id = permalink.match(/\/comments\/([a-z0-9]+)/i)?.[1]
  return id ? `https://redd.it/${id}` : `https://www.reddit.com${permalink}`
}

/**
 * A stable, non-garish favicon for a domain. Fetching a site's own
 * `/favicon.ico` directly is unreliable (missing, wrong content-type,
 * redirects) and renders as a broken image in the embed; Google's favicon
 * service resolves those cases server-side and always returns a real image
 * (falling back to a generic globe icon), so the embed's eyebrow icon never
 * breaks.
 */
export function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`
}

/**
 * A deterministic accent color per flair, so the embed's left bar is
 * flair-coded without hand-maintaining a flair -> color map that would go
 * stale as the subreddit adds flairs (flairs/roles are otherwise created
 * automatically, see ensureRoleIds). Falls back to Discord's neutral grey
 * for flairless posts.
 */
export function flairColor(flairText: string | undefined): number {
  if (!flairText) return 0x4e5058
  let hash = 0
  for (let i = 0; i < flairText.length; i++) {
    hash = (hash * 31 + flairText.charCodeAt(i)) | 0
  }
  const hue = ((hash % 360) + 360) % 360
  return hslToRgbInt(hue, 65, 55)
}

function hslToRgbInt(h: number, s: number, l: number): number {
  const sNorm = s / 100
  const lNorm = l / 100
  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = lNorm - c / 2
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  const toByte = (v: number) => Math.round((v + m) * 255)
  return (toByte(r) << 16) | (toByte(g) << 8) | toByte(b)
}

/**
 * Resolves which role ids to ping for a post, purely from the name->id
 * cache the last flair sync built (see syncFlairRoles) - no live Discord
 * lookup here. A flair whose role isn't in the cache yet (created since the
 * last sync) is reported via `missingFlairRoleName` rather than chased down
 * live: the post still goes out, just without that one ping, and starts
 * pinging again once the next sync picks up the new flair.
 */
export function resolveMentionedRoleIds(
  roleCache: Readonly<Record<string, string>>,
  flairText: string | undefined,
): {roleIds: string[]; missingFlairRoleName: string | undefined} {
  const flairRoleName = flairText
    ? discordRoleNameForFlair(flairText)
    : undefined
  const roleNames = [flairRoleName, CATCH_ALL_DISCORD_ROLE_NAME].filter(
    (name): name is string => name !== undefined,
  )
  const roleIds = roleNames
    .map(name => roleCache[name])
    .filter((id): id is string => id !== undefined)
  const missingFlairRoleName =
    flairRoleName !== undefined && roleCache[flairRoleName] === undefined
      ? flairRoleName
      : undefined
  return {roleIds, missingFlairRoleName}
}

/**
 * Posts the announcement embed, pinging the flair's role and the opt-in
 * catch-all role, crossposts it so following servers receive it, then
 * reacts with the server's upvote/downvote emoji.
 */
export async function postAnnouncement(
  channelId: string,
  botToken: string,
  upvoteEmoji: string,
  downvoteEmoji: string,
  post: AnnouncementPost,
  roleCache: Readonly<Record<string, string>>,
): Promise<void> {
  const {roleIds: mentionedRoleIds, missingFlairRoleName} =
    resolveMentionedRoleIds(roleCache, post.flairText)
  if (missingFlairRoleName) {
    logWarn('flair role not cached; announcing without that ping', {
      flairText: post.flairText,
      roleName: missingFlairRoleName,
    })
  }

  const domain = sourceDomain(post.url)
  const embed = {
    title: post.title,
    url: post.url,
    color: flairColor(post.flairText),
    author: domain
      ? {name: domain, url: post.url, icon_url: faviconUrl(domain)}
      : undefined,
    fields: [
      {name: 'Author', value: post.authorName, inline: true},
      {name: 'Comments', value: commentsUrl(post.permalink), inline: true},
    ],
  }

  // The title is repeated in plain content, not just the embed, because
  // crossposted/followed copies of this message can land in channels where
  // the "Embed Links" permission is off - the content line is all that
  // survives there.
  const mentions = mentionedRoleIds.map(id => `<@&${id}>`).join(' ')
  const message = await discordFetch<DiscordMessage>(
    `/channels/${channelId}/messages`,
    botToken,
    {
      method: 'POST',
      body: JSON.stringify({
        content: `${post.title}\n${mentions}`,
        embeds: [embed],
        allowed_mentions: {roles: mentionedRoleIds},
      }),
    },
  )

  // Publish before reacting: crossposting is what fans the announcement out
  // to following servers, so it goes out while the request budget is
  // freshest; the reactions are cosmetic and can afford to be the ones that
  // occasionally miss.
  await sleep(API_CALL_PACING_MS)
  await crosspost(channelId, message.id, botToken)

  for (const emoji of [upvoteEmoji, downvoteEmoji]) {
    await sleep(API_CALL_PACING_MS)
    try {
      await addReaction(channelId, message.id, botToken, emoji)
    } catch (err) {
      // Non-critical: a bad/missing emoji shouldn't block the announcement.
      logWarn('reaction failed', {
        channelId,
        messageId: message.id,
        emoji,
        err: errorDetail(err),
      })
    }
  }
}

/**
 * Pause between sequential Discord API calls for one announcement.
 * Bursting them back-to-back (post, crosspost, two reactions) has tripped
 * both Discord's own per-route rate limit (reactions) and Devvit's
 * outbound-request throttle (crosspost) in production; spacing every call
 * out clears both.
 */
const API_CALL_PACING_MS = 300

/**
 * Crossposts the announcement so following servers receive it, retrying
 * once after another paced delay on failure - the same burst that trips
 * Discord's or Devvit's rate limit the first time has usually cleared by
 * then. Non-critical either way: the announcement is already posted, and a
 * non-Announcement channel (or one nobody follows) will keep failing here
 * regardless, which is fine.
 */
async function crosspost(
  channelId: string,
  messageId: string,
  botToken: string,
): Promise<void> {
  const path = `/channels/${channelId}/messages/${messageId}/crosspost`
  try {
    await discordFetch(path, botToken, {method: 'POST'})
    return
  } catch (err) {
    logWarn('crosspost failed; retrying once', {
      channelId,
      messageId,
      err: errorDetail(err),
    })
  }
  await sleep(API_CALL_PACING_MS)
  try {
    await discordFetch(path, botToken, {method: 'POST'})
  } catch (err) {
    logWarn('crosspost retry failed', {
      channelId,
      messageId,
      err: errorDetail(err),
    })
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
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
