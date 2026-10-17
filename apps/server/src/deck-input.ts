import { cardCatalog } from '@bfw/game-data'
import { validateDeck } from '@bfw/game-core'

type CardInput = { cardId: string; quantity: number }
const playable = cardCatalog.filter(card => !card.Tags?.includes('в разработке'))
const ids = new Set(playable.map(card => card.Id))

export function parseDeckCards(value: unknown): { cards: CardInput[]; expanded: string[] } | null {
  if (!Array.isArray(value) || value.length > 30) return null
  const seen = new Set<string>()
  const cards: CardInput[] = []
  const expanded: string[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    if (Object.keys(item).some(key => key !== 'cardId' && key !== 'quantity')) return null
    const { cardId, quantity } = item as Record<string, unknown>
    if (typeof cardId !== 'string' || !ids.has(cardId) || seen.has(cardId)) return null
    if (!Number.isInteger(quantity) || (quantity as number) < 1 || (quantity as number) > 30) return null
    seen.add(cardId)
    cards.push({ cardId, quantity: quantity as number })
    expanded.push(...Array.from({ length: quantity as number }, () => cardId))
    if (expanded.length > 30) return null
  }
  return { cards, expanded }
}

export function validateDeckDraft(expanded: readonly string[]) {
  const errors: string[] = []
  if (expanded.length !== 30) errors.push('DECK_SIZE')
  const definitions = expanded.map(id => playable.find(card => card.Id === id))
  if (expanded.some((_, index) => !definitions[index])) errors.push('CARD_NOT_PLAYABLE')
  const cards = definitions.filter((card): card is (typeof playable)[number] => !!card)
  if (cards.length === 30 && [15, 12, 3].some((expected, index) => cards.filter(card => card.Rarity === index).length !== expected)) errors.push('RARITY_SPLIT')
  if (cards.length && new Set(cards.map(card => card.Class)).size > 2) errors.push('CLASS_LIMIT')
  const copies = new Map<string, number>()
  for (const id of expanded) copies.set(id, (copies.get(id) ?? 0) + 1)
  if (cards.some(card => card.Rarity < 2 && copies.get(card.Id)! > 2)) errors.push('COPY_LIMIT')
  return { valid: errors.length === 0 && validateDeck(expanded, playable), errors }
}
