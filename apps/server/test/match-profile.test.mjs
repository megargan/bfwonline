import assert from 'node:assert/strict'
import test from 'node:test'
import { createMatch } from '@bfw/game-core'
import { randomLegalDeck } from '../../../packages/game-core/src/deck.ts'
import { cardCatalog } from '@bfw/game-data'
import { projectMatchForPlayer } from '../src/match-profile.ts'

test('match snapshots show public avatars for both seats without adding opponent private state', async () => {
  const deck = randomLegalDeck(cardCatalog)
  const state = createMatch({
    matchId: 'match-1', catalog: cardCatalog,
    players: [{ userId: 'user-1', displayName: 'Ник 1', deck }, { userId: 'user-2', displayName: 'Ник 2', deck }],
    random: () => 0.25,
  })
  const database = { query: async () => ({ rows: [
    { seat: 0, user_id: 'user-1', avatar_version: 3, has_avatar: true },
    { seat: 1, user_id: 'user-2', avatar_version: 0, has_avatar: false },
  ] }) }

  const snapshot = await projectMatchForPlayer(database, state.id, state, 0)

  assert.deepEqual(snapshot.public.players.map(({ name, avatarUrl }) => [name, avatarUrl]), [
    ['Ник 1', '/api/v1/users/user-1/avatar?v=3'],
    ['Ник 2', null],
  ])
  assert.equal(snapshot.private.seat, 0)
  assert.equal('hand' in snapshot.public.players[1], false)
})
