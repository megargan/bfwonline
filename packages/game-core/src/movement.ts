type MovingUnit = {
  id: string; owner: number; row: number; col: number; health: number; maxHealth: number; attack: number; speed: number
  card: { Name: string; Type: number }; item?: { Name: string }; flippedTurns?: number; dying?: boolean; doggoBuffs?: number
}
type MovingPlayer = { mana: number; deck: unknown[]; hand: unknown[] }
type MovementState<T extends MovingUnit, P extends MovingPlayer> = { board: T[]; players: P[]; wheatTokens?: { row: number; col: number }[] }

export function applyMovementStateTriggers<T extends MovingUnit, P extends MovingPlayer>(
  state: MovementState<T, P>, moved: T, previousRow: number, activeSeat: number, speed: number,
  destroyMoved: (unit: T) => void, doggoBeforeDestroy = false,
) {
  const effects = { wheatCollected: false, basilDraw: false, cheapTrickDestroyed: false, doggoCount: 0 }
  if (moved.card.Type !== 0) return effects

  const wheatIndex = (state.wheatTokens ?? []).findIndex(token => token.row === moved.row && token.col === moved.col)
  if (wheatIndex >= 0) {
    state.wheatTokens!.splice(wheatIndex, 1)
    state.players[moved.owner]!.mana++
    effects.wheatCollected = true
  }
  if (moved.card.Name === 'Базилик' && moved.owner !== activeSeat && !moved.flippedTurns && !moved.dying) {
    const owner = state.players[moved.owner]!
    if (owner.deck.length) owner.hand.push(owner.deck.shift()!)
    effects.basilDraw = true
  }
  effects.cheapTrickDestroyed = Boolean(moved.item?.Name === 'Cheap Trick' && !moved.dying && (moved.owner === 0 ? moved.row < previousRow : moved.row > previousRow))
  if (!doggoBeforeDestroy && effects.cheapTrickDestroyed) destroyMoved(moved)
  if (speed >= 1) for (const doggo of state.board.filter(unit => unit.card.Name === 'Догго' && unit.id !== moved.id && !unit.dying)) {
    doggo.attack++
    doggo.speed--
    doggo.health++
    doggo.maxHealth++
    doggo.doggoBuffs = (doggo.doggoBuffs ?? 0) + 1
    effects.doggoCount++
  }
  if (doggoBeforeDestroy && effects.cheapTrickDestroyed) destroyMoved(moved)
  return effects
}
