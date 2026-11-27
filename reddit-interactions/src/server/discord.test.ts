import assert from 'node:assert/strict'
import {test} from 'node:test'
import {
  buildPickerComponents,
  buildPickerEmbed,
  commentsUrl,
  discordRoleNameForFlair,
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
