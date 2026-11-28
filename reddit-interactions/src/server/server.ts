import {once} from 'node:events'
import type {IncomingMessage, ServerResponse} from 'node:http'
import type {OnPostSubmitRequest, TriggerResponse} from '@devvit/shared'
import {context, redis, settings} from '@devvit/web/server'
import {postAnnouncement} from './discord.ts'
import {errorDetail, logError, logWarn} from './log.ts'
import {syncFlairRoles} from './roleSync.ts'

type ErrorRsp = {error: string; status: number}
type AnyRsp = TriggerResponse | ErrorRsp

/** Redis key (per-install scoped) holding the bot-created picker message id. */
const PICKER_MESSAGE_ID_KEY = 'discordPickerMessageId'

/**
 * Redis key (per-install scoped) holding the roleName -> id cache built by
 * the last flair sync. postAnnouncement reads this instead of asking
 * Discord for the guild's role list on every single post.
 */
const ROLE_CACHE_KEY = 'discordRoleCache'

/** Reads the roleName -> id cache, defaulting to empty if the sync job hasn't run yet. */
async function getRoleCache(): Promise<Record<string, string>> {
  const raw = await redis.get(ROLE_CACHE_KEY)
  return raw ? JSON.parse(raw) : {}
}

export async function onReq(
  reqMsg: IncomingMessage,
  rspMsg: ServerResponse,
): Promise<void> {
  try {
    await route(reqMsg, rspMsg)
  } catch (err) {
    const detail = errorDetail(err)
    logError('server error', {
      method: reqMsg.method,
      url: reqMsg.url,
      err: detail,
    })
    writeJson<ErrorRsp>(
      500,
      {error: `server error; ${detail}`, status: 500},
      rspMsg,
    )
  }
}

/** Names of settings in `named` whose value is missing, for a "which setting?" log line. */
function missingSettings(named: Record<string, string | undefined>): string[] {
  return Object.entries(named)
    .filter(([, value]) => !value)
    .map(([name]) => name)
}

async function route(
  reqMsg: IncomingMessage,
  rspMsg: ServerResponse,
): Promise<void> {
  const endpoint = reqMsg.url?.slice(1)

  let rsp: AnyRsp
  if (reqMsg.method !== 'POST') {
    rsp = {error: 'not found', status: 404}
  } else if (endpoint === 'internal/on/post/submit') {
    rsp = await routePostSubmit(reqMsg)
  } else if (endpoint === 'internal/on/schedule/sync-flair-roles') {
    rsp = await routeSyncFlairRoles()
  } else {
    rsp = {error: 'not found', status: 404}
  }

  writeJson<AnyRsp>('status' in rsp ? rsp.status : 200, rsp, rspMsg)
}

async function routePostSubmit(
  reqMsg: IncomingMessage,
): Promise<TriggerResponse> {
  const event = await readJson<OnPostSubmitRequest>(reqMsg)
  const {post, author} = event
  if (!post || !author) return {}

  const [botToken, channelId, upvoteEmoji, downvoteEmoji] = await Promise.all([
    settings.get<string>('discordBotToken'),
    settings.get<string>('discordChannelId'),
    settings.get<string>('discordUpvoteEmoji'),
    settings.get<string>('discordDownvoteEmoji'),
  ])
  if (!botToken || !channelId || !upvoteEmoji || !downvoteEmoji) {
    logWarn('announcement skipped: subreddit not configured', {
      subreddit: context.subredditName,
      missing: missingSettings({
        discordBotToken: botToken,
        discordChannelId: channelId,
        discordUpvoteEmoji: upvoteEmoji,
        discordDownvoteEmoji: downvoteEmoji,
      }).join(','),
    })
    return {}
  }

  try {
    const roleCache = await getRoleCache()
    await postAnnouncement(
      channelId,
      botToken,
      upvoteEmoji,
      downvoteEmoji,
      {
        title: post.title,
        permalink: post.permalink,
        url: post.url,
        flairText: post.linkFlair?.text,
        authorName: author.name,
      },
      roleCache,
    )
  } catch (err) {
    logError('post announcement failed', {
      subreddit: context.subredditName,
      postId: post.id,
      title: post.title,
      err: errorDetail(err),
    })
  }
  return {}
}

async function routeSyncFlairRoles(): Promise<TriggerResponse> {
  const [botToken, guildId, pickerChannelId] = await Promise.all([
    settings.get<string>('discordBotToken'),
    settings.get<string>('discordGuildId'),
    settings.get<string>('discordPickerChannelId'),
  ])
  if (!botToken || !guildId || !pickerChannelId) {
    logWarn('flair role sync skipped: subreddit not configured', {
      subreddit: context.subredditName,
      missing: missingSettings({
        discordBotToken: botToken,
        discordGuildId: guildId,
        discordPickerChannelId: pickerChannelId,
      }).join(','),
    })
    return {}
  }

  try {
    const storedMessageId = await redis.get(PICKER_MESSAGE_ID_KEY)
    const {pickerMessageId, roleIds} = await syncFlairRoles({
      subredditName: context.subredditName,
      guildId,
      pickerChannelId,
      pickerMessageId: storedMessageId,
      botToken,
    })
    if (pickerMessageId !== storedMessageId) {
      await redis.set(PICKER_MESSAGE_ID_KEY, pickerMessageId)
    }
    await redis.set(ROLE_CACHE_KEY, JSON.stringify(roleIds))
  } catch (err) {
    logError('flair role sync failed', {
      subreddit: context.subredditName,
      err: errorDetail(err),
    })
  }
  return {}
}

async function readJson<T>(reqMsg: IncomingMessage): Promise<T> {
  const chunks: Uint8Array[] = []
  reqMsg.on('data', chunk => chunks.push(chunk))
  await once(reqMsg, 'end')
  return JSON.parse(`${Buffer.concat(chunks)}`)
}

function writeJson<T>(
  status: number,
  json: Readonly<T>,
  rsp: ServerResponse,
): void {
  const body = JSON.stringify(json)
  const len = Buffer.byteLength(body)
  rsp.writeHead(status, {
    'Content-Length': len,
    'Content-Type': 'application/json',
  })
  rsp.end(body)
}
