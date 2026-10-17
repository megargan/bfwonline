import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { processAvatar } from '../src/avatar.ts'

test('normalizes an allowed image to a square metadata-free WebP', async () => {
  const input = await sharp({ create: { width: 480, height: 320, channels: 3, background: '#e67e22' } }).jpeg().toBuffer()
  const output = await processAvatar(input)
  const metadata = await sharp(output).metadata()
  assert.equal(metadata.format, 'webp')
  assert.equal(metadata.width, 256)
  assert.equal(metadata.height, 256)
  assert.equal(metadata.exif, undefined)
  assert.ok(output.length <= 262_144)
})

test('rejects malformed, unsupported and oversized-dimension images', async () => {
  await assert.rejects(processAvatar(Buffer.from('not an image')), error => error.code === 'AVATAR_INVALID')
  await assert.rejects(processAvatar(Buffer.from('<svg></svg>')), error => error.code === 'AVATAR_UNSUPPORTED')
  const tooWide = await sharp({ create: { width: 4097, height: 1, channels: 3, background: '#000' } }).png().toBuffer()
  await assert.rejects(processAvatar(tooWide), error => error.code === 'AVATAR_DIMENSIONS')
})
