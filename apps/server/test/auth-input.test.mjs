import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeDisplayName, normalizeUsername, validPassword } from '../src/auth-input.ts'

test('normalizes usernames before applying the ASCII login rule', () => {
  assert.equal(normalizeUsername(' Player_1 '), 'player_1')
  assert.equal(normalizeUsername('ab'), null)
  assert.equal(normalizeUsername('лесной'), null)
})

test('preserves passwords exactly and enforces the documented length', () => {
  assert.equal(validPassword(' 1234567890 '), true)
  assert.equal(validPassword('12345678901'), false)
  assert.equal(validPassword('x'.repeat(129)), false)
})

test('trims display names, counts Unicode code points, and rejects controls', () => {
  assert.equal(normalizeDisplayName('  лесной маг  '), 'лесной маг')
  assert.equal(normalizeDisplayName('😀'.repeat(33)), null)
  assert.equal(normalizeDisplayName('bad\nname'), null)
  assert.equal(normalizeDisplayName('\nvalid'), null)
})
