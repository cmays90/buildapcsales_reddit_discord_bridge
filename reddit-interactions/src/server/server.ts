import {once} from 'node:events'
import type {IncomingMessage, ServerResponse} from 'node:http'
import type {OnPostSubmitRequest, TriggerResponse} from '@devvit/shared'
import {settings} from '@devvit/web/server'
import {postAnnouncement} from './discord.ts'

type ErrorRsp = {error: string; status: number}
type AnyRsp = TriggerResponse | ErrorRsp

export async function onReq(
  reqMsg: IncomingMessage,
  rspMsg: ServerResponse,
): Promise<void> {
  try {
    await route(reqMsg, rspMsg)
  } catch (err) {
    const msg = `server error; ${err instanceof Error ? err.stack : err}`
    console.error(msg)
    writeJson<ErrorRsp>(500, {error: msg, status: 500}, rspMsg)
  }
}

async function route(
  reqMsg: IncomingMessage,
  rspMsg: ServerResponse,
): Promise<void> {
  const endpoint = reqMsg.url?.slice(1)

  let rsp: AnyRsp
  if (reqMsg.method !== 'POST' || endpoint !== 'internal/on/post/submit') {
    rsp = {error: 'not found', status: 404}
  } else {
    rsp = await routePostSubmit(reqMsg)
  }

  writeJson<AnyRsp>('status' in rsp ? rsp.status : 200, rsp, rspMsg)
}

async function routePostSubmit(
  reqMsg: IncomingMessage,
): Promise<TriggerResponse> {
  const event = await readJson<OnPostSubmitRequest>(reqMsg)
  const {post, author} = event
  if (!post || !author) return {}

  const [botToken, guildId, channelId] = await Promise.all([
    settings.get<string>('discordBotToken'),
    settings.get<string>('discordGuildId'),
    settings.get<string>('discordChannelId'),
  ])
  if (!botToken || !guildId || !channelId) {
    console.warn(
      'reddit-interactions is not configured for this subreddit; skipping announcement',
    )
    return {}
  }

  try {
    await postAnnouncement(guildId, channelId, botToken, {
      title: post.title,
      permalink: post.permalink,
      url: post.url,
      flairText: post.linkFlair?.text,
      authorName: author.name,
    })
  } catch (err) {
    console.error(
      `failed to announce post ${post.id}; ${err instanceof Error ? err.stack : err}`,
    )
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
