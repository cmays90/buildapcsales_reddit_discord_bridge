import assert from 'node:assert/strict'
import {test} from 'node:test'
import {clampOptions, diffOptions} from './roleSync.ts'

test('diffOptions is a no-op when current already matches desired', () => {
  const current = [
    {label: 'All Posts', value: '1'},
    {label: 'GPU', value: '2'},
  ]
  const desired = [
    {label: 'GPU', value: '2'},
    {label: 'All Posts', value: '1'},
  ]
  assert.equal(diffOptions(current, desired), undefined)
})

test('diffOptions returns the full desired list when a role is added', () => {
  const current = [{label: 'All Posts', value: '1'}]
  const desired = [
    {label: 'All Posts', value: '1'},
    {label: 'GPU', value: '2'},
  ]
  assert.deepEqual(diffOptions(current, desired), desired)
})

test('diffOptions returns the full desired list when a role is removed', () => {
  const current = [
    {label: 'All Posts', value: '1'},
    {label: 'GPU', value: '2'},
  ]
  const desired = [{label: 'All Posts', value: '1'}]
  assert.deepEqual(diffOptions(current, desired), desired)
})

test('diffOptions treats a renamed flair (same id, new label) as a change', () => {
  const current = [{label: 'GPU', value: '2'}]
  const desired = [{label: 'Graphics Cards', value: '2'}]
  assert.deepEqual(diffOptions(current, desired), desired)
})

test('clampOptions passes through lists at or under the limit', () => {
  const options = [{label: 'A', value: '1'}]
  assert.deepEqual(clampOptions(options), {options, truncated: false})
})

test('clampOptions truncates to 25, alphabetically, and reports truncation', () => {
  const options = Array.from({length: 30}, (_, i) => ({
    label: `Flair ${String(i).padStart(2, '0')}`,
    value: String(i),
  }))
  const {options: clamped, truncated} = clampOptions(options)
  assert.equal(clamped.length, 25)
  assert.equal(truncated, true)
  assert.deepEqual(clamped, options.slice(0, 25))
})
