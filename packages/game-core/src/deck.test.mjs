import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomLegalDeck, validateDeck } from './deck.ts'

const catalog = Array.from({ length: 30 }, (_, index) => ({
  Id: `card-${index}`,
  Rarity: index < 15 ? 0 : index < 27 ? 1 : 2,
  Class: index % 2,
  Tags: [],
}))
const playableDeck = catalog.map(card => card.Id)

test('accepts the required 30-card rarity split and one or two classes', () => {
  assert.equal(validateDeck(playableDeck, catalog), true)
})

test('rejects an ineligible card and a third copy of a common card', () => {
  assert.equal(validateDeck(['unknown', ...playableDeck.slice(1)], catalog), false)
  assert.equal(validateDeck(['card-0', 'card-0', 'card-0', ...playableDeck.slice(3)], catalog), false)
})

test('rejects invalid rarity totals and more than two classes', () => {
  assert.equal(validateDeck([...playableDeck.slice(1), 'card-15'], catalog), false)
  const threeClasses = catalog.map((card, index) => index < 15 ? { ...card, Class: 0 } : index < 27 ? { ...card, Class: 1 } : { ...card, Class: 2 })
  assert.equal(validateDeck(playableDeck, threeClasses), false)
})

test('the canonical catalog contains unique IDs and can produce a legal deck', () => {
  const cards = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8'))
  assert.equal(new Set(cards.map(card => card.Id)).size, cards.length)
  assert.equal(Boolean(cards.find(card => card.Name === 'Салюбра').Tags?.includes('в разработке')), false)
  assert.equal(Boolean(cards.find(card => card.Name === 'Янгуша').Tags?.includes('в разработке')), false)
  assert.equal(Boolean(cards.find(card => card.Name === 'Жёлтый').Tags?.includes('в разработке')), false)
  const eligible = cards.filter(card => !card.Tags?.includes('в разработке'))
  let deck
  for (let first = 0; first < 6 && !deck; first++) for (let second = first; second < 6 && !deck; second++) {
    const ids = []
    for (const [rarity, amount] of [[0, 15], [1, 12], [2, 3]]) {
      const options = eligible.filter(card => card.Rarity === rarity && (card.Class === first || card.Class === second))
      for (const card of options) {
        const maxCopies = rarity === 2 ? amount : 2
        while (ids.filter(id => id === card.Id).length < maxCopies && ids.filter(id => eligible.find(option => option.Id === id)?.Rarity === rarity).length < amount) ids.push(card.Id)
      }
      if (ids.filter(id => eligible.find(option => option.Id === id)?.Rarity === rarity).length !== amount) break
    }
    if (ids.length === 30 && validateDeck(ids, cards)) deck = ids
  }
  assert.ok(deck, 'expected at least one playable 30-card selection')
})

test('randomLegalDeck always returns a server-valid list', () => {
  const cards = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8'))
  const deck = randomLegalDeck(cards, () => 0.42)
  assert.equal(deck?.length, 30)
  assert.equal(validateDeck(deck, cards), true)
})
