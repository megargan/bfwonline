import { randomInt, randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { cardCatalog, RULES_VERSION } from '@bfw/game-data'
import { createMatch } from '@bfw/game-core'
import { projectMatchForPlayer } from './match-profile.ts'
import { RoomError, RoomManager } from './room-manager.ts'
import { RoomTransport } from './room-transport.ts'

const startLocks = new Map<string, Promise<void>>()

async function withStartLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = startLocks.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(resolve => { release = resolve })
  startLocks.set(key, current)
  await previous
  try { return await run() }
  finally {
    release()
    if (startLocks.get(key) === current) startLocks.delete(key)
  }
}

export function startMatchForRoom(pool: Pool, rooms: RoomManager, transport: RoomTransport, userId: string, roomId: string) {
  return withStartLock(roomId, async () => {
    const room = rooms.current(userId)
    if (!room || room.id !== roomId) throw new RoomError('ROOM_NOT_FOUND')
    if (room.ownerUserId !== userId) throw new RoomError('OWNER_ONLY')
    if (room.status === 'playing' && room.matchId) return room
    if (!room.canStart) throw new RoomError('PLAYERS_NOT_READY')

    const seatViews = new Map(rooms.roomUpdates(roomId).map(update => [update.userId, update.view]))
    const participants = room.participants.map(player => {
      const view = seatViews.get(player.userId)
      if (!view?.myDeckId || view.myDeckRevision === null) throw new RoomError('DECK_NOT_SELECTED')
      return { ...player, deckId: view.myDeckId, revision: view.myDeckRevision }
    })
    const decks = await Promise.all(participants.map(async player => {
      const { rows } = await pool.query<{ id: string; revision: number; card_id: string | null; quantity: number | null }>(
        `SELECT d.id,d.revision,dc.card_id,dc.quantity FROM decks d
         LEFT JOIN deck_cards dc ON dc.deck_id=d.id WHERE d.id=$1 AND d.owner_id=$2`, [player.deckId, player.userId],
      )
      if (!rows.length) throw new RoomError('DECK_NOT_FOUND')
      if (rows[0].revision !== player.revision) throw new RoomError('DECK_CHANGED')
      return rows.filter(row => row.card_id).flatMap(row => Array(Number(row.quantity)).fill(row.card_id) as string[])
    }))
    const matchId = randomUUID()
    const match = createMatch({
      matchId,
      players: participants.map((player, seat) => ({ userId: player.userId, displayName: player.displayName, deck: decks[seat]! })),
      catalog: cardCatalog,
      random: () => randomInt(0, 0x1_0000_0000) / 0x1_0000_0000,
      rulesVersion: RULES_VERSION,
    })
    const client = await pool.connect()
    let committed = false
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`bfw-room:${roomId}`])
      const existing = await client.query<{ id: string; state_json: typeof match }>(
        `SELECT id,state_json FROM matches WHERE room_id=$1 AND status='active' FOR UPDATE`, [roomId],
      )
      if (existing.rows[0]) {
        await client.query('COMMIT')
        committed = true
        rooms.start(userId, existing.rows[0].id, roomId)
        transport.publish(rooms.roomUpdates(roomId))
        for (let seat = 0; seat < participants.length; seat++) {
          const player = participants[seat]!
          const persisted = existing.rows[0].state_json
          transport.send(player.userId, 'match.started', { seat, rulesVersion: persisted.rulesVersion }, { matchId: persisted.id, version: persisted.version })
          transport.send(player.userId, 'match.snapshot', await projectMatchForPlayer(pool, persisted.id, persisted, seat), { matchId: persisted.id, version: persisted.version })
        }
        return rooms.current(userId)!
      }

      const latest = rooms.current(userId)
      if (!latest || latest.id !== roomId || !latest.canStart || latest.revision !== room.revision) throw new RoomError('PLAYERS_NOT_READY')
      for (const player of participants) {
        const lockedDeck = await client.query<{ revision: number }>(
          'SELECT revision FROM decks WHERE id=$1 AND owner_id=$2 FOR SHARE', [player.deckId, player.userId],
        )
        if (lockedDeck.rows[0]?.revision !== player.revision) throw new RoomError('DECK_CHANGED')
      }
      await client.query(
        `INSERT INTO matches (id,room_id,status,version,rules_version,engine_version,state_json)
         VALUES ($1,$2,'active',0,$3,'1',$4::jsonb)`, [matchId, roomId, RULES_VERSION, JSON.stringify(match)],
      )
      for (let seat = 0; seat < participants.length; seat++) {
        const player = participants[seat]!
        await client.query(
          `INSERT INTO match_players (match_id,seat,user_id,username_snapshot,display_name_snapshot,deck_snapshot_json)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
          [matchId, seat, player.userId, player.username, player.displayName, JSON.stringify({ revision: player.revision, cards: decks[seat] })],
        )
      }
      await client.query('COMMIT')
      committed = true
    } catch (error) {
      if (!committed) await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }

    try { rooms.start(userId, matchId, roomId) }
    catch (error) {
      await pool.query(`UPDATE matches SET status='aborted',state_json=NULL,ended_at=now(),end_reason='room_changed_during_start' WHERE id=$1 AND status='active'`, [matchId]).catch(() => undefined)
      throw error
    }
    transport.publish(rooms.roomUpdates(roomId))
    for (let seat = 0; seat < participants.length; seat++) {
      transport.send(participants[seat]!.userId, 'match.started', { seat, rulesVersion: match.rulesVersion }, { matchId, version: match.version })
      transport.send(participants[seat]!.userId, 'match.snapshot', await projectMatchForPlayer(pool, matchId, match, seat), { matchId, version: match.version })
    }
    return rooms.current(userId)!
  })
}
