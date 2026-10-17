export type PendingDeath<T> = { unit: T; options: { flipTurns?: number; burn?: boolean; killer?: T }; explicitlyDestroyed: boolean }
export type AttackResolutionState<T> = { depth: number; pendingDeaths: PendingDeath<T>[] }

export function createAttackResolutionState<T>(): AttackResolutionState<T> {
  return { depth: 0, pendingDeaths: [] }
}

export function queuePendingDeath<T extends { id: string }>(state: AttackResolutionState<T>, unit: T, options: PendingDeath<T>['options'], explicitlyDestroyed: boolean) {
  const existing = state.pendingDeaths.find(item => item.unit.id === unit.id)
  if (existing) {
    existing.options.flipTurns ??= options.flipTurns
    existing.options.burn = Boolean(existing.options.burn || options.burn)
    existing.options.killer ??= options.killer
    existing.explicitlyDestroyed ||= explicitlyDestroyed
  } else state.pendingDeaths.push({ unit, options: { ...options }, explicitlyDestroyed })
}
