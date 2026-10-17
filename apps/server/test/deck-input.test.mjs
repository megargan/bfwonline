import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDeckCards, validateDeckDraft } from '../src/deck-input.ts'

test('accepts empty and partial drafts but only a legal deck validates', async () => {
  const empty = parseDeckCards([])
  assert.deepEqual(empty, { cards: [], expanded: [] })
  assert.deepEqual(validateDeckDraft(empty.expanded), { valid: false, errors: ['DECK_SIZE'] })

  const { cardCatalog } = await import('@bfw/game-data')
  const eligible = cardCatalog.filter(card => !card.Tags?.includes('в разработке'))
  let cards
  for (let first = 0; first < 6 && !cards; first++) for (let second = first; second < 6 && !cards; second++) {
    const deckCards = []
    for (const [rarity, amount] of [[0, 15], [1, 12], [2, 3]]) {
      const options = eligible.filter(card => card.Rarity === rarity && (card.Class === first || card.Class === second))
      for (const card of options) while (deckCards.filter(item => item.cardId === card.Id).length < (rarity === 2 ? amount : 2) && deckCards.filter(item => eligible.find(option => option.Id === item.cardId)?.Rarity === rarity).length < amount) deckCards.push({ cardId: card.Id })
      if (deckCards.filter(item => eligible.find(option => option.Id === item.cardId)?.Rarity === rarity).length !== amount) break
    }
    if (deckCards.length === 30) cards = [...new Set(deckCards.map(card => card.cardId))].map(cardId => ({ cardId, quantity: deckCards.filter(card => card.cardId === cardId).length }))
  }
  assert.ok(cards)
  const result = parseDeckCards(cards)
  assert.equal(validateDeckDraft(result.expanded).valid, true)
})

test('rejects unknown IDs, duplicate rows, invalid quantities and more than 30 cards', async () => {
  const { cardCatalog } = await import('@bfw/game-data')
  const id = cardCatalog[0].Id
  assert.equal(parseDeckCards([{ cardId: 'unknown', quantity: 1 }]), null)
  assert.equal(parseDeckCards([{ cardId: id, quantity: 1 }, { cardId: id, quantity: 1 }]), null)
  assert.equal(parseDeckCards([{ cardId: id, quantity: 0 }]), null)
  assert.equal(parseDeckCards([{ cardId: id, quantity: 31 }]), null)
  assert.equal(parseDeckCards([{ cardId: id, quantity: 1, ownerId: 'someone-else' }]), null)
})
