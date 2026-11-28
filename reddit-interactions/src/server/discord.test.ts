import assert from 'node:assert/strict'
import {test} from 'node:test'
import {
  buildPickerComponents,
  buildPickerEmbed,
  commentsUrl,
  discordRoleNameForFlair,
  faviconUrl,
  flairColor,
  resolveMentionedRoleIds,
  sourceDomain,
} from './discord.ts'

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

test('buildPickerComponents embeds the options and caps max_values to their count', () => {
  const options = [
    {label: 'All Posts', value: '1'},
    {label: 'GPU', value: '2'},
  ]
  const [row] = buildPickerComponents(options, 'Pick a category')
  const [select] = row.components ?? []
  assert.equal(select?.custom_id, 'notify-roles')
  assert.equal(select?.placeholder, 'Pick a category')
  assert.equal(select?.min_values, 0)
  assert.equal(select?.max_values, options.length)
  assert.deepEqual(select?.options, options)
})

test('buildPickerEmbed has a non-empty description and an https image url', () => {
  const embed = buildPickerEmbed()
  assert.ok(embed.description.length > 0)
  assert.match(embed.image.url, /^https:\/\//)
})

test('discordRoleNameForFlair lowercases and prefixes a single word', () => {
  assert.equal(discordRoleNameForFlair('GPU'), 'alert:gpu')
})

test('discordRoleNameForFlair hyphenates multi-word flairs', () => {
  assert.equal(discordRoleNameForFlair('Mouse Pad'), 'alert:mouse-pad')
})

test('discordRoleNameForFlair collapses punctuation into single hyphens', () => {
  assert.equal(discordRoleNameForFlair('SSD (SATA)'), 'alert:ssd-sata')
})

test('faviconUrl requests Google favicon service for the given domain', () => {
  assert.equal(
    faviconUrl('amazon.com'),
    'https://www.google.com/s2/favicons?sz=64&domain=amazon.com',
  )
})

test('faviconUrl encodes a domain with special characters', () => {
  assert.equal(
    faviconUrl('foo bar.com'),
    'https://www.google.com/s2/favicons?sz=64&domain=foo%20bar.com',
  )
})

test('flairColor is deterministic for the same flair', () => {
  assert.equal(flairColor('CPU'), flairColor('CPU'))
})

test('flairColor differs across flairs', () => {
  assert.notEqual(flairColor('CPU'), flairColor('GPU'))
})

test('flairColor returns a valid 24-bit color', () => {
  const color = flairColor('CPU')
  assert.ok(color >= 0 && color <= 0xffffff)
})

test('flairColor falls back to neutral grey for flairless posts', () => {
  assert.equal(flairColor(undefined), 0x4e5058)
})

test('resolveMentionedRoleIds pings both the flair and catch-all roles when cached', () => {
  const cache = {'alert:cpu': '111', 'alert:bapcs': '222'}
  assert.deepEqual(resolveMentionedRoleIds(cache, 'CPU'), {
    roleIds: ['111', '222'],
    missingFlairRoleName: undefined,
  })
})

test('resolveMentionedRoleIds pings only the catch-all role when flairless', () => {
  const cache = {'alert:bapcs': '222'}
  assert.deepEqual(resolveMentionedRoleIds(cache, undefined), {
    roleIds: ['222'],
    missingFlairRoleName: undefined,
  })
})

test('resolveMentionedRoleIds skips the flair ping on a cache miss rather than looking it up live', () => {
  const cache = {'alert:bapcs': '222'}
  assert.deepEqual(resolveMentionedRoleIds(cache, 'GPU'), {
    roleIds: ['222'],
    missingFlairRoleName: 'alert:gpu',
  })
})

test('resolveMentionedRoleIds pings nothing when the cache is empty', () => {
  assert.deepEqual(resolveMentionedRoleIds({}, 'CPU'), {
    roleIds: [],
    missingFlairRoleName: 'alert:cpu',
  })
})
