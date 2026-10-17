import test from 'node:test'
import assert from 'node:assert/strict'
import { cardCatalog, STARTER_DECKS } from './index.ts'
import { validateDeck } from '../../game-core/src/deck.ts'

test('starter decks are three distinct legal 30-card lists', () => {
  assert.equal(STARTER_DECKS.length, 3)
  const names = new Set()
  const deckIds = new Set()
  for (const starter of STARTER_DECKS) {
    assert.ok(starter.name)
    assert.equal(starter.cards.length, 30)
    assert.ok(validateDeck(starter.cards.map(name => cardCatalog.find(card => card.Name === name)?.Id ?? ''), cardCatalog), starter.name)
    assert.equal(new Set(starter.cards).size, 17)
    names.add(starter.name)
    deckIds.add(starter.cards.join('|'))
  }
  assert.equal(names.size, 3)
  assert.equal(deckIds.size, 3)
})
