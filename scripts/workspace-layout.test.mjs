import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

test('Vue client is a workspace app under apps/web', () => {
  const manifest = JSON.parse(readFileSync(new URL('../apps/web/package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.name, '@bfw/web')
  assert.ok(manifest.scripts.build)
  for (const path of ['../apps/web/index.html', '../apps/web/src/App.vue', '../apps/web/public/cards']) {
    assert.ok(existsSync(new URL(path, import.meta.url)), `${path} exists`)
  }
  for (const path of ['../index.html', '../src', '../public', '../vite.config.ts']) {
    assert.equal(existsSync(new URL(path, import.meta.url)), false, `${path} is not an app entry at the workspace root`)
  }
})
