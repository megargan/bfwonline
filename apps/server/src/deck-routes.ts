import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify'
import type { Pool } from 'pg'
import { cardCatalog, RULES_VERSION } from '@bfw/game-data'
import { parseDeckCards, validateDeckDraft } from './deck-input.ts'

function deckName(value: unknown) {
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) return null
  const name = value.trim()
  const length = [...name].length
  return length > 0 && length <= 64 ? name : null
}
function ownsSession(request: FastifyRequest, reply: FastifyReply) {
  if (!request.authSession) { reply.code(401).send({ error: 'UNAUTHENTICATED' }); return false }
  return true
}
function writeAllowed(request: FastifyRequest, reply: FastifyReply, appOrigin: string) {
  if (request.headers.origin !== appOrigin) { reply.code(403).send({ error: 'ORIGIN_FORBIDDEN' }); return false }
  if (!request.authSession || request.headers['x-csrf-token'] !== request.authSession.csrf_token) {
    reply.code(403).send({ error: 'CSRF_INVALID' }); return false
  }
  return true
}
function parsedId(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) }
function decodeCursor(value: unknown) {
  if (typeof value !== 'string') return 0
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8')
    return /^(0|[1-9]\d{0,5})$/.test(decoded) ? Number(decoded) : null
  } catch { return null }
}
function cardsFromRows(rows: { card_id: string; quantity: number }[]) {
  return rows.map(row => ({ cardId: row.card_id, quantity: Number(row.quantity) }))
}
function deckDto(row: { id: string; name: string; revision: number; updated_at: Date }, cards: { cardId: string; quantity: number }[]) {
  const expanded = cards.flatMap(card => Array(card.quantity).fill(card.cardId) as string[])
  return {
    id: row.id, name: row.name, revision: row.revision, cards,
    updatedAt: row.updated_at, rulesVersion: RULES_VERSION,
    validation: validateDeckDraft(expanded),
  }
}

export function registerDeckRoutes(app: FastifyInstance, pool: Pool, loadSession: preHandlerHookHandler, appOrigin: string) {
  app.get('/api/v1/cards', async (_request, reply) => {
    const cards = cardCatalog.filter(card => !card.Tags?.includes('в разработке'))
    const etag = `"${RULES_VERSION}-${cards.length}"`
    reply.header('ETag', etag).header('Cache-Control', 'public, max-age=300')
    if (_request.headers['if-none-match'] === etag) return reply.code(304).send()
    return { rulesVersion: RULES_VERSION, cards }
  })

  app.get('/api/v1/decks', { preHandler: loadSession }, async (request, reply) => {
    if (!ownsSession(request, reply)) return
    const query = request.query as { limit?: string; cursor?: string }
    const limit = query.limit === undefined ? 50 : Number(query.limit)
    const offset = decodeCursor(query.cursor)
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || offset === null) return reply.code(400).send({ error: 'INVALID_PAGINATION' })
    const { rows } = await pool.query('SELECT id, name, revision, updated_at FROM decks WHERE owner_id=$1 ORDER BY updated_at DESC, id LIMIT $2 OFFSET $3', [request.authSession!.user_id, limit, offset])
    reply.header('Cache-Control', 'no-store')
    return { items: rows, nextCursor: rows.length === limit ? Buffer.from(String(offset + limit)).toString('base64url') : null }
  })

  app.get('/api/v1/decks/:deckId', { preHandler: loadSession }, async (request, reply) => {
    if (!ownsSession(request, reply)) return
    const { deckId } = request.params as { deckId: string }
    if (!parsedId(deckId)) return reply.code(404).send({ error: 'DECK_NOT_FOUND' })
    const result = await pool.query('SELECT id, name, revision, updated_at FROM decks WHERE id=$1 AND owner_id=$2', [deckId, request.authSession!.user_id])
    if (!result.rows[0]) return reply.code(404).send({ error: 'DECK_NOT_FOUND' })
    const cards = await pool.query('SELECT card_id, quantity FROM deck_cards WHERE deck_id=$1 ORDER BY card_id', [deckId])
    reply.header('Cache-Control', 'no-store')
    return deckDto(result.rows[0] as never, cardsFromRows(cards.rows as { card_id: string; quantity: number }[]))
  })

  app.post('/api/v1/decks', { preHandler: loadSession }, async (request, reply) => {
    if (!ownsSession(request, reply)) return
    if (!writeAllowed(request, reply, appOrigin)) return
    const body = request.body as Record<string, unknown> | null
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply.code(400).send({ error: 'INVALID_INPUT' })
    if (Object.keys(body).some(key => !['name', 'cards'].includes(key))) return reply.code(400).send({ error: 'INVALID_INPUT' })
    const name = deckName(body.name)
    const parsed = parseDeckCards(body.cards)
    if (!name || !parsed) return reply.code(400).send({ error: 'INVALID_DECK' })
    const userId = request.authSession!.user_id
    const deckId = randomUUID()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])
      const count = await client.query('SELECT count(*)::int AS count FROM decks WHERE owner_id=$1', [userId])
      if (count.rows[0].count >= 100) { await client.query('ROLLBACK'); return reply.code(422).send({ error: 'DECK_LIMIT' }) }
      const inserted = await client.query('INSERT INTO decks(id,owner_id,name) VALUES($1,$2,$3) RETURNING id,name,revision,updated_at', [deckId, userId, name])
      if (parsed.cards.length) await client.query('INSERT INTO deck_cards(deck_id,card_id,quantity) SELECT $1,card_id,quantity FROM unnest($2::uuid[],$3::smallint[]) AS c(card_id,quantity)', [deckId, parsed.cards.map(card => card.cardId), parsed.cards.map(card => card.quantity)])
      await client.query('COMMIT')
      reply.header('Cache-Control', 'no-store')
      return reply.code(201).send(deckDto(inserted.rows[0] as never, parsed.cards))
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
  })

  app.put('/api/v1/decks/:deckId', { preHandler: loadSession }, async (request, reply) => {
    if (!ownsSession(request, reply)) return
    if (!writeAllowed(request, reply, appOrigin)) return
    const { deckId } = request.params as { deckId: string }
    const body = request.body as Record<string, unknown> | null
    if (!parsedId(deckId)) return reply.code(404).send({ error: 'DECK_NOT_FOUND' })
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply.code(400).send({ error: 'INVALID_INPUT' })
    if (Object.keys(body).some(key => !['name', 'cards', 'expectedRevision'].includes(key))) return reply.code(400).send({ error: 'INVALID_INPUT' })
    const name = deckName(body.name)
    const parsed = parseDeckCards(body.cards)
    if (!name || !parsed || !Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 1) return reply.code(400).send({ error: 'INVALID_DECK' })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const current = await client.query('SELECT id,name,revision,updated_at FROM decks WHERE id=$1 AND owner_id=$2 FOR UPDATE', [deckId, request.authSession!.user_id])
      if (!current.rows[0]) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'DECK_NOT_FOUND' }) }
      if (current.rows[0].revision !== body.expectedRevision) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'DECK_CHANGED', currentRevision: current.rows[0].revision }) }
      const updated = await client.query('UPDATE decks SET name=$2, revision=revision+1, updated_at=now() WHERE id=$1 RETURNING id,name,revision,updated_at', [deckId, name])
      await client.query('DELETE FROM deck_cards WHERE deck_id=$1', [deckId])
      if (parsed.cards.length) await client.query('INSERT INTO deck_cards(deck_id,card_id,quantity) SELECT $1,card_id,quantity FROM unnest($2::uuid[],$3::smallint[]) AS c(card_id,quantity)', [deckId, parsed.cards.map(card => card.cardId), parsed.cards.map(card => card.quantity)])
      await client.query('COMMIT')
      reply.header('Cache-Control', 'no-store')
      return deckDto(updated.rows[0] as never, parsed.cards)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
  })

  app.delete('/api/v1/decks/:deckId', { preHandler: loadSession }, async (request, reply) => {
    if (!ownsSession(request, reply)) return
    if (!writeAllowed(request, reply, appOrigin)) return
    const { deckId } = request.params as { deckId: string }
    const { expectedRevision } = request.query as { expectedRevision?: string }
    if (!parsedId(deckId)) return reply.code(404).send({ error: 'DECK_NOT_FOUND' })
    if (!expectedRevision || !/^[1-9]\d*$/.test(expectedRevision) || !Number.isSafeInteger(Number(expectedRevision))) return reply.code(400).send({ error: 'INVALID_REVISION' })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const current = await client.query('SELECT revision FROM decks WHERE id=$1 AND owner_id=$2 FOR UPDATE', [deckId, request.authSession!.user_id])
      if (!current.rows[0]) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'DECK_NOT_FOUND' }) }
      if (current.rows[0].revision !== Number(expectedRevision)) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'DECK_CHANGED', currentRevision: current.rows[0].revision }) }
      await client.query('DELETE FROM decks WHERE id=$1', [deckId])
      await client.query('COMMIT')
      reply.header('Cache-Control', 'no-store')
      return reply.code(204).send()
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
  })
}
