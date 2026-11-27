import assert from 'node:assert/strict'
import {test} from 'node:test'
import {commentsUrl, sourceDomain} from './discord.ts'

test('sourceDomain strips a leading www.', () => {
  assert.equal(sourceDomain('https://www.newegg.com/deal'), 'newegg.com')
})

test('sourceDomain reads the bare host', () => {
  assert.equal(
    sourceDomain('https://old.reddit.com/r/buildapcsales'),
    'old.reddit.com',
  )
})

test('sourceDomain returns undefined for an unparsable url', () => {
  assert.equal(sourceDomain('not a url'), undefined)
})

test('commentsUrl prefixes the permalink', () => {
  assert.equal(
    commentsUrl('/r/buildapcsales/comments/abc123/title/'),
    'https://www.reddit.com/r/buildapcsales/comments/abc123/title/',
  )
})
