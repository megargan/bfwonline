import { cardCatalog, STARTER_DECKS } from '../../../packages/game-data/src'
import { validateDeck } from '../../../packages/game-core/src/deck'

export type SavedDeck = {
  id: string
  name: string
  revision: number
  cards: (typeof cardCatalog)[number][]
  playable: boolean
}

export async function loadSavedDecks(request: (path: string) => Promise<any>): Promise<SavedDeck[]> {
  const summaries: { id: string }[] = []
  let cursor = ''
  do {
    const page = await request(`/decks?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    summaries.push(...page.items)
    cursor = page.nextCursor ?? ''
  } while (cursor)
  const catalog = new Map(cardCatalog.map(card => [card.Id, card]))
  const decks = await Promise.all(summaries.map(async summary => {
    const data = await request(`/decks/${summary.id}`)
    const ids: string[] = data.cards.flatMap((item: { cardId: string; quantity: number }) => Array(item.quantity).fill(item.cardId))
    return {
      id: data.id, name: data.name, revision: data.revision,
      cards: ids.map(id => catalog.get(id)).filter(card => card !== undefined),
      playable: validateDeck(ids, cardCatalog),
    }
  }))
  const order = new Map(STARTER_DECKS.map((starter, index) => [starter.name, index]))
  return decks.sort((a, b) => (order.get(a.name) ?? 99) - (order.get(b.name) ?? 99))
}
