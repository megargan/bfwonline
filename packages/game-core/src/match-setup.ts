import { validateDeck } from './deck.ts'
import type { MatchState } from './match.ts'

type CatalogCard = { Id: string; Name: string; Description?: string; Type: number; Cost?: number; Attack?: number; Health?: number; Speed?: number; Rarity: number; Class: number; Tags?: string[]; [key: string]: unknown }
type PlayerInput = { userId: string; displayName: string; deck: readonly string[] }
type MatchInput = { matchId: string; players: readonly PlayerInput[]; catalog: readonly CatalogCard[]; random?: () => number; rulesVersion?: string }

export const shuffle = <T>(items: T[], random: () => number): T[] => {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)))
    ;[result[i], result[j]] = [result[j]!, result[i]!]
  }
  return result
}

export function createMatch({ matchId, players, catalog, random = Math.random, rulesVersion = '1' }: MatchInput): MatchState {
  if (players.length !== 2 || players.some(player => !validateDeck(player.deck, catalog))) {
    throw Object.assign(new Error('Both players need a playable deck'), { code: 'DECK_NOT_PLAYABLE' })
  }
  const cards = new Map(catalog.map(card => [card.Id, card]))
  const statePlayers = players.map(({ userId, displayName, deck }, seat) => {
    const pool = shuffle(deck.map((id, index) => ({ ...cards.get(id)!, instanceId: `ci_${matchId}_${seat}_${index}` })), random)
    const opening = pool.filter(card => Number(card.Cost ?? 0) <= 2).slice(0, 2)
    for (const card of opening) pool.splice(pool.indexOf(card), 1)
    const randomDraw = shuffle(pool, random).slice(0, 2)
    for (const card of randomDraw) pool.splice(pool.indexOf(card), 1)
    return {
      userId, name: displayName, health: 45, mana: seat === 0 ? 1 : 0, energy: seat === 0 ? 1 : 0, limit: 4,
      deck: shuffle(pool, random), hand: [...opening, ...randomDraw], discard: [], burned: [], saved: [],
      played: false, burnedThisTurn: false, nextScoreAdjustment: 0, gendaBossStacks: 0, freePlayCardIds: [],
    }
  })
  return { id: matchId, version: 0, status: 'active', rulesVersion, current: 0, round: 1, players: statePlayers, board: [], wheatTokens: [], log: ['Партия готова. Игрок 1 открывает первый раунд.'], pendingTurnStart: null }
}
