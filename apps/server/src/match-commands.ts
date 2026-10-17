import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { applyCommand, type MatchState } from '@bfw/game-core'
import type { GameCommand } from '@bfw/contracts'
import { projectMatchForPlayer } from './match-profile.ts'

export class MatchCommandError extends Error {
  readonly code: string
  constructor(code: string) { super(code); this.code = code }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}

function requestHash(command: GameCommand) {
  return createHash('sha256').update(canonical({ expectedVersion: command.expectedVersion, action: command.action, data: command.data })).digest()
}

async function matchSeats(client: PoolClient, matchId: string) {
  const { rows } = await client.query<{ user_id: string; seat: number }>(
    'SELECT user_id,seat FROM match_players WHERE match_id=$1 ORDER BY seat', [matchId],
  )
  return rows
}

export async function readMatchSnapshot(pool: Pool, userId: string, matchId: string) {
  const { rows } = await pool.query<{ state_json: MatchState; seat: number }>(
    `SELECT m.state_json,mp.seat FROM matches m JOIN match_players mp ON mp.match_id=m.id
     WHERE m.id=$1 AND mp.user_id=$2`, [matchId, userId],
  )
  if (!rows[0]) throw new MatchCommandError('MATCH_NOT_FOUND')
  return projectMatchForPlayer(pool, matchId, rows[0].state_json, rows[0].seat)
}

export async function applyMatchCommand(pool: Pool, actorUserId: string, command: GameCommand, commandAllowed: () => boolean = () => true) {
  const client = await pool.connect()
  let committed = false
  try {
    await client.query('BEGIN')
    const matchResult = await client.query<{ status: string; version: number; state_json: MatchState }>(
      'SELECT status,version,state_json FROM matches WHERE id=$1 FOR UPDATE', [command.matchId],
    )
    const matchRow = matchResult.rows[0]
    if (!matchRow) throw new MatchCommandError('MATCH_NOT_FOUND')
    const seats = await matchSeats(client, command.matchId)
    const actorSeat = seats.find(player => player.user_id === actorUserId)?.seat
    if (actorSeat !== 0 && actorSeat !== 1) throw new MatchCommandError('NOT_A_PARTICIPANT')

    const receiptResult = await client.query<{ actor_user_id: string; request_hash: Buffer; applied_version: number }>(
      'SELECT actor_user_id,request_hash,applied_version FROM match_commands WHERE match_id=$1 AND command_id=$2',
      [command.matchId, command.commandId],
    )
    const hash = requestHash(command)
    const receipt = receiptResult.rows[0]
    if (receipt) {
      if (receipt.actor_user_id !== actorUserId || !Buffer.from(receipt.request_hash).equals(hash)) throw new MatchCommandError('COMMAND_ID_CONFLICT')
      const snapshot = await projectMatchForPlayer(client, command.matchId, matchRow.state_json, actorSeat)
      await client.query('COMMIT')
      committed = true
      return {
        kind: 'duplicate' as const, commandId: command.commandId, appliedVersion: receipt.applied_version,
        snapshots: [{ userId: actorUserId, snapshot }],
      }
    }

    if (!commandAllowed()) throw new MatchCommandError('MATCH_PAUSED')
    if (matchRow.status !== 'active' || matchRow.state_json.status !== 'active') throw new MatchCommandError('MATCH_NOT_ACTIVE')
    if (matchRow.version !== command.expectedVersion) {
      const snapshot = await projectMatchForPlayer(client, command.matchId, matchRow.state_json, actorSeat)
      await client.query('COMMIT')
      committed = true
      return { kind: 'rejected' as const, commandId: command.commandId, code: 'STALE_STATE_VERSION', currentVersion: matchRow.version, snapshots: [{ userId: actorUserId, snapshot }] }
    }

    let result: ReturnType<typeof applyCommand>
    try { result = applyCommand(matchRow.state_json, actorSeat, command) }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw new MatchCommandError(String(error.code))
      throw error
    }
    const winnerUserId = result.state.winnerUserId ?? null
    await client.query(
      `UPDATE matches SET status=$2,version=$3,state_json=$4::jsonb,winner_user_id=$5,end_reason=$6,
       ended_at=CASE WHEN $2='finished' THEN now() ELSE NULL END WHERE id=$1`,
      [command.matchId, result.state.status, result.state.version, JSON.stringify(result.state), winnerUserId, result.state.endReason ?? null],
    )
    await client.query(
      `INSERT INTO match_commands (match_id,command_id,actor_user_id,request_hash,applied_version)
       VALUES ($1,$2,$3,$4,$5)`, [command.matchId, command.commandId, actorUserId, hash, result.state.version],
    )
    const snapshots = await Promise.all(seats.map(async player => ({
      userId: player.user_id,
      snapshot: await projectMatchForPlayer(client, command.matchId, result.state, player.seat),
    })))
    await client.query('COMMIT')
    committed = true
    return {
      kind: 'applied' as const, commandId: command.commandId, appliedVersion: result.state.version,
      matchId: command.matchId, version: result.state.version, events: result.events,
      snapshots,
    }
  } catch (error) {
    if (!committed) await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { client.release() }
}
