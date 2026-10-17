import sharp from 'sharp'

const MAX_INPUT = 5 * 1024 * 1024
const MAX_OUTPUT = 256 * 1024
const MAX_PIXELS = 16_000_000
let activeDecodes = 0
const decodeQueue: (() => void)[] = []

export class AvatarError extends Error {
  readonly code: string
  constructor(code: string) { super(code); this.code = code }
}

function isSvg(input: Buffer) {
  const header = input.subarray(0, 1024).toString('utf8').trimStart()
  return /^<svg\b/i.test(header) || (header.startsWith('<?xml') && /<svg\b/i.test(header))
}

async function acquireDecodeSlot() {
  if (activeDecodes >= 2) {
    if (decodeQueue.length >= 10) throw new AvatarError('AVATAR_BUSY')
    await new Promise<void>(resolve => decodeQueue.push(resolve))
  } else activeDecodes++
}

function releaseDecodeSlot() {
  const next = decodeQueue.shift()
  if (next) next()
  else activeDecodes--
}

export async function processAvatar(input: Buffer): Promise<Buffer> {
  if (!input.length || input.length > MAX_INPUT) throw new AvatarError('AVATAR_TOO_LARGE')
  await acquireDecodeSlot()
  try {
    const image = sharp(input, { failOn: 'error', limitInputPixels: MAX_PIXELS, sequentialRead: true }).timeout({ seconds: 5 })
    let metadata
    try { metadata = await image.metadata() }
    catch (error) {
      if (isSvg(input) || input.subarray(0, 6).toString('ascii') === 'GIF87a' || input.subarray(0, 6).toString('ascii') === 'GIF89a') throw new AvatarError('AVATAR_UNSUPPORTED')
      if (error instanceof Error && /pixel limit|too many pixels/i.test(error.message)) throw new AvatarError('AVATAR_DIMENSIONS')
      throw new AvatarError('AVATAR_INVALID')
    }
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '')) throw new AvatarError('AVATAR_UNSUPPORTED')
    if ((metadata.pages ?? 1) > 1) throw new AvatarError('AVATAR_ANIMATED')
    if (!metadata.width || !metadata.height || metadata.width > 4096 || metadata.height > 4096 || metadata.width * metadata.height > MAX_PIXELS) {
      throw new AvatarError('AVATAR_DIMENSIONS')
    }
    let output: Buffer
    try { output = await image.rotate().resize(256, 256, { fit: 'cover', position: 'centre' }).webp({ quality: 82, effort: 4 }).toBuffer() }
    catch { throw new AvatarError('AVATAR_INVALID') }
    if (output.length > MAX_OUTPUT) throw new AvatarError('AVATAR_OUTPUT_TOO_LARGE')
    return output
  } finally { releaseDecodeSlot() }
}
