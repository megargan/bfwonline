type DeckCard = { Id: string; Rarity: number; Class: number; Tags?: string[] }

export function validateDeck(deck: readonly string[], catalog: readonly DeckCard[]): boolean {
  if (deck.length !== 30) return false

  const cards = new Map(catalog.map(card => [card.Id, card]))
  const selected = deck.map(id => cards.get(id))
  if (selected.some(card => !card || card.Tags?.includes('в разработке'))) return false

  const resolved = selected as DeckCard[]
  const rarities = [0, 1, 2].map(rarity => resolved.filter(card => card.Rarity === rarity).length)
  const classes = new Set(resolved.map(card => card.Class))
  const copies = new Map<string, number>()
  for (const card of resolved) copies.set(card.Id, (copies.get(card.Id) ?? 0) + 1)

  return rarities[0] === 15
    && rarities[1] === 12
    && rarities[2] === 3
    && classes.size >= 1
    && classes.size <= 2
    && resolved.every(card => card.Rarity >= 2 || (copies.get(card.Id) ?? 0) <= 2)
}

export function randomLegalDeck(catalog: readonly DeckCard[], random: () => number = Math.random): string[] | null {
  const playable = catalog.filter(card => !card.Tags?.includes('в разработке'))
  const classes = [...new Set(playable.map(card => card.Class))]
  for (let first = 0; first < classes.length; first++) for (let second = first; second < classes.length; second++) {
    const classPair = new Set([classes[first], classes[second]])
    const deck: string[] = []
    let possible = true
    for (const [rarity, target] of [[0, 15], [1, 12], [2, 3]] as const) {
      const candidates = playable.filter(card => card.Rarity === rarity && classPair.has(card.Class))
        .map(card => ({ card, sort: random() })).sort((a, b) => a.sort - b.sort)
      for (const { card } of candidates) {
        const limit = rarity === 2 ? target : 2
        while (deck.filter(id => id === card.Id).length < limit
          && deck.filter(id => playable.find(entry => entry.Id === id)?.Rarity === rarity).length < target) deck.push(card.Id)
      }
      if (deck.filter(id => playable.find(entry => entry.Id === id)?.Rarity === rarity).length !== target) { possible = false; break }
    }
    if (possible && validateDeck(deck, playable)) return deck.sort(() => random() - 0.5)
  }
  return null
}
