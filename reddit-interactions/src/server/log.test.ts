import assert from 'node:assert/strict'
import {test} from 'node:test'
import {errorDetail, formatLog} from './log.ts'

test('formatLog returns the bare event when there are no fields', () => {
  assert.equal(formatLog('role sync skipped'), 'role sync skipped')
})

test('formatLog renders fields as quoted key=value pairs', () => {
  assert.equal(
    formatLog('announcement skipped', {
      subreddit: 'bapcs_bridge_dev',
      missing: 'discordGuildId,discordUpvoteEmoji',
    }),
    'announcement skipped subreddit="bapcs_bridge_dev" missing="discordGuildId,discordUpvoteEmoji"',
  )
})

test('formatLog renders numbers and booleans unquoted', () => {
  assert.equal(
    formatLog('role picker truncated', {flairCount: 30, limit: 25}),
    'role picker truncated flairCount=30 limit=25',
  )
})

test('formatLog drops undefined fields', () => {
  assert.equal(
    formatLog('reaction failed', {channelId: '123', messageId: undefined}),
    'reaction failed channelId="123"',
  )
})

test('formatLog appends an err field after a newline instead of quoting it inline', () => {
  assert.equal(
    formatLog('flair role sync failed', {
      subreddit: 'bapcs_bridge_dev',
      err: 'Error: Discord API PUT ... -> 403',
    }),
    'flair role sync failed subreddit="bapcs_bridge_dev"\nError: Discord API PUT ... -> 403',
  )
})

test('errorDetail prefers an Error stack over its message', () => {
  const err = new Error('boom')
  assert.equal(errorDetail(err), err.stack)
})

test('errorDetail stringifies a non-Error value', () => {
  assert.equal(errorDetail('not an error'), 'not an error')
})
