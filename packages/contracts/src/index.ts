const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type CommandIdentity = { matchId: string; commandId: string; expectedVersion: number }
export type TurnEndData = Record<never, never>
  | { option: 'no_penalty' }
  | { option: 'discard_and_decrease_limit'; discardedCardInstanceIds: string[] }
  | { option: 'increase_limit_after_round_5' }
export type UnitMoveData = { unitId: string; to: { row: number; col: number } }
export type UnitAttackData = { unitId: string; targetUnitId: string }
export type UnitAttackPlayerData = { unitId: string }
export type AbilityUseData = { unitId: string; abilityIndex: number; scoreAdjustment?: -1 | 1 }
export type ItemEquipData = { cardInstanceId: string; targetUnitId: string; payment: 'mana' | 'health' }
export type CardPlayData = { cardInstanceId: string; target: { row: number; col: number }; payment: 'mana' | 'health'; horny?: boolean }
export type SpellCastData = { cardInstanceId: string; payment: 'mana' | 'health'; target?: { row: number; col: number } | { unitId: string } | { player: 'self' | 'opponent' }; choice?: 'mana' | 'energy'; manaAmount?: number; healthAmount?: number }
export type ChoiceResolveData = { choiceId: string; selection: { unitId: string } | { unitIds: string[] } | { cell: { row: number; col: number } } | { player: 'self' | 'opponent' } | { tokenClass: number } | { choice: 'draw' | 'limit' | 'mana' | 'energy' | 'viskas-draw' | 'viskas-discard' | 'swarm-draw' | 'swarm-mana' | 'keep' | 'discard' } | { choice: 'librarian-cost'; cost: 1 | 2 | 4 } | { choice: 'librarian-pile'; pile: 'deck' | 'discard' } }
export type GameCommand = (CommandIdentity & { action: 'match.concede'; data: Record<string, never> })
  | (CommandIdentity & { action: 'turn.end'; data: TurnEndData })
  | (CommandIdentity & { action: 'unit.move'; data: UnitMoveData })
  | (CommandIdentity & { action: 'unit.attack'; data: UnitAttackData })
  | (CommandIdentity & { action: 'unit.attackPlayer'; data: UnitAttackPlayerData })
  | (CommandIdentity & { action: 'ability.use'; data: AbilityUseData })
  | (CommandIdentity & { action: 'item.equip'; data: ItemEquipData })
  | (CommandIdentity & { action: 'card.play'; data: CardPlayData })
  | (CommandIdentity & { action: 'card.takeSaved'; data: { cardInstanceId: string } })
  | (CommandIdentity & { action: 'spell.cast'; data: SpellCastData })
  | (CommandIdentity & { action: 'choice.resolve'; data: ChoiceResolveData })
export type ClientMessage =
  | { type: 'session.hello'; payload: { protocolVersion: 1 } }
  | { type: 'match.subscribe'; payload: { matchId: string } }
  | { type: 'match.resync'; payload: { matchId: string; lastKnownVersion: number } }
  | { type: 'game.command'; payload: GameCommand }

function invalid(code = 'INVALID_MESSAGE'): never { throw Object.assign(new Error(code), { code }) }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) invalid()
}
function validUuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value) }

export function parseClientMessage(value: unknown): ClientMessage {
  if (!record(value) || typeof value.type !== 'string' || !record(value.payload)) invalid()
  const payload = value.payload
  if (value.type === 'session.hello') {
    exactKeys(value, ['type', 'payload']); exactKeys(payload, ['protocolVersion'])
    if (payload.protocolVersion !== 1) invalid('PROTOCOL_MISMATCH')
    return { type: 'session.hello', payload: { protocolVersion: 1 } }
  }
  if (value.type === 'match.subscribe') {
    exactKeys(value, ['type', 'payload']); exactKeys(payload, ['matchId'])
    if (!validUuid(payload.matchId)) invalid()
    return { type: 'match.subscribe', payload: { matchId: payload.matchId } }
  }
  if (value.type === 'match.resync') {
    exactKeys(value, ['type', 'payload']); exactKeys(payload, ['matchId', 'lastKnownVersion'])
    if (!validUuid(payload.matchId) || !Number.isSafeInteger(payload.lastKnownVersion) || Number(payload.lastKnownVersion) < 0) invalid()
    return { type: 'match.resync', payload: { matchId: payload.matchId, lastKnownVersion: Number(payload.lastKnownVersion) } }
  }
  if (value.type === 'game.command') {
    exactKeys(value, ['type', 'payload']); exactKeys(payload, ['matchId', 'commandId', 'expectedVersion', 'action', 'data'])
    if (!validUuid(payload.matchId) || !validUuid(payload.commandId) || !Number.isSafeInteger(payload.expectedVersion) || Number(payload.expectedVersion) < 0 || !record(payload.data)) invalid()
    const identity = { matchId: payload.matchId, commandId: payload.commandId, expectedVersion: Number(payload.expectedVersion) }
    if (payload.action === 'match.concede') {
      exactKeys(payload.data, [])
      return { type: 'game.command', payload: { ...identity, action: 'match.concede', data: {} } }
    }
    if (payload.action === 'turn.end') {
      const data = payload.data
      if (!Object.keys(data).length) return { type: 'game.command', payload: { ...identity, action: 'turn.end', data: {} } }
      if (data.option === 'no_penalty' || data.option === 'increase_limit_after_round_5') {
        exactKeys(data, ['option'])
        return { type: 'game.command', payload: { ...identity, action: 'turn.end', data: { option: data.option } } }
      }
      if (data.option === 'discard_and_decrease_limit') {
        exactKeys(data, ['option', 'discardedCardInstanceIds'])
        if (!Array.isArray(data.discardedCardInstanceIds) || data.discardedCardInstanceIds.length < 1 || data.discardedCardInstanceIds.length > 2 || data.discardedCardInstanceIds.some(id => typeof id !== 'string' || id.length < 1 || id.length > 128) || new Set(data.discardedCardInstanceIds).size !== data.discardedCardInstanceIds.length) invalid()
        return { type: 'game.command', payload: { ...identity, action: 'turn.end', data: { option: data.option, discardedCardInstanceIds: [...data.discardedCardInstanceIds] } } }
      }
      invalid()
    }
    if (payload.action === 'unit.move') {
      const data = payload.data
      if (Object.keys(data).length !== 2 || typeof data.unitId !== 'string' || data.unitId.length < 1 || data.unitId.length > 128 || !record(data.to)) invalid()
      exactKeys(data.to, ['row', 'col'])
      if (!Number.isInteger(data.to.row) || Number(data.to.row) < 0 || Number(data.to.row) > 4 || !Number.isInteger(data.to.col) || Number(data.to.col) < 0 || Number(data.to.col) > 4) invalid()
      return { type: 'game.command', payload: { ...identity, action: 'unit.move', data: { unitId: data.unitId, to: { row: Number(data.to.row), col: Number(data.to.col) } } } }
    }
    if (payload.action === 'unit.attack') {
      const data = payload.data
      if (Object.keys(data).length !== 2 || [data.unitId, data.targetUnitId].some(id => typeof id !== 'string' || id.length < 1 || id.length > 128)) invalid()
      return { type: 'game.command', payload: { ...identity, action: 'unit.attack', data: { unitId: data.unitId as string, targetUnitId: data.targetUnitId as string } } }
    }
    if (payload.action === 'unit.attackPlayer') {
      const data = payload.data
      if (Object.keys(data).length !== 1 || typeof data.unitId !== 'string' || data.unitId.length < 1 || data.unitId.length > 128) invalid()
      return { type: 'game.command', payload: { ...identity, action: 'unit.attackPlayer', data: { unitId: data.unitId } } }
    }
    if (payload.action === 'ability.use') {
      const data = payload.data
      if (Object.keys(data).some(key => !['unitId', 'abilityIndex', 'scoreAdjustment'].includes(key)) || !['unitId', 'abilityIndex'].every(key => Object.hasOwn(data, key)) || typeof data.unitId !== 'string' || data.unitId.length < 1 || data.unitId.length > 128 || !Number.isInteger(data.abilityIndex) || Number(data.abilityIndex) < 0 || Number(data.abilityIndex) > 32 || Object.hasOwn(data, 'scoreAdjustment') && data.scoreAdjustment !== -1 && data.scoreAdjustment !== 1) invalid()
      return { type: 'game.command', payload: { ...identity, action: 'ability.use', data: { unitId: data.unitId, abilityIndex: Number(data.abilityIndex), ...(data.scoreAdjustment === 1 || data.scoreAdjustment === -1 ? { scoreAdjustment: data.scoreAdjustment } : {}) } } }
    }
    if (payload.action === 'item.equip') {
      const data = payload.data
      if (Object.keys(data).length !== 3 || [data.cardInstanceId, data.targetUnitId].some(id => typeof id !== 'string' || id.length < 1 || id.length > 128) || data.payment !== 'mana' && data.payment !== 'health') invalid()
      return { type: 'game.command', payload: { ...identity, action: 'item.equip', data: { cardInstanceId: data.cardInstanceId as string, targetUnitId: data.targetUnitId as string, payment: data.payment } } }
    }
    if (payload.action === 'card.play') {
      const data = payload.data
      if (Object.keys(data).some(key => !['cardInstanceId', 'target', 'payment', 'horny'].includes(key)) || !['cardInstanceId', 'target', 'payment'].every(key => Object.hasOwn(data, key)) || typeof data.cardInstanceId !== 'string' || data.cardInstanceId.length < 1 || data.cardInstanceId.length > 128 || !record(data.target) || data.payment !== 'mana' && data.payment !== 'health' || Object.hasOwn(data, 'horny') && typeof data.horny !== 'boolean') invalid()
      exactKeys(data.target, ['row', 'col'])
      if (!Number.isInteger(data.target.row) || Number(data.target.row) < 0 || Number(data.target.row) > 4 || !Number.isInteger(data.target.col) || Number(data.target.col) < 0 || Number(data.target.col) > 4) invalid()
      return { type: 'game.command', payload: { ...identity, action: 'card.play', data: { cardInstanceId: data.cardInstanceId, target: { row: Number(data.target.row), col: Number(data.target.col) }, payment: data.payment, ...(data.horny === true ? { horny: true } : {}) } } }
    }
    if (payload.action === 'card.takeSaved') {
      const data = payload.data
      exactKeys(data, ['cardInstanceId'])
      if (typeof data.cardInstanceId !== 'string' || data.cardInstanceId.length < 1 || data.cardInstanceId.length > 128) invalid()
      return { type: 'game.command', payload: { ...identity, action: 'card.takeSaved', data: { cardInstanceId: data.cardInstanceId } } }
    }
    if (payload.action === 'spell.cast') {
      const data = payload.data
      if (Object.keys(data).some(key => !['cardInstanceId', 'payment', 'target', 'choice', 'manaAmount', 'healthAmount'].includes(key)) || !['cardInstanceId', 'payment'].every(key => Object.hasOwn(data, key)) || typeof data.cardInstanceId !== 'string' || data.cardInstanceId.length < 1 || data.cardInstanceId.length > 128 || data.payment !== 'mana' && data.payment !== 'health' || Object.hasOwn(data, 'choice') && data.choice !== 'mana' && data.choice !== 'energy' || Object.hasOwn(data, 'manaAmount') && (!Number.isInteger(data.manaAmount) || Number(data.manaAmount) < 0 || Number(data.manaAmount) > 1000) || Object.hasOwn(data, 'healthAmount') && (!Number.isInteger(data.healthAmount) || Number(data.healthAmount) < 0 || Number(data.healthAmount) > 1000)) invalid()
      if (Object.hasOwn(data, 'target')) {
        if (!record(data.target)) invalid()
        if (Object.hasOwn(data.target, 'row') || Object.hasOwn(data.target, 'col')) {
          exactKeys(data.target, ['row', 'col'])
          if (!Number.isInteger(data.target.row) || Number(data.target.row) < 0 || Number(data.target.row) > 4 || !Number.isInteger(data.target.col) || Number(data.target.col) < 0 || Number(data.target.col) > 4) invalid()
        } else if (Object.hasOwn(data.target, 'unitId')) {
          exactKeys(data.target, ['unitId'])
          if (typeof data.target.unitId !== 'string' || !data.target.unitId || data.target.unitId.length > 128) invalid()
        } else {
          exactKeys(data.target, ['player'])
          if (data.target.player !== 'opponent' && data.target.player !== 'self') invalid()
        }
      }
      return { type: 'game.command', payload: { ...identity, action: 'spell.cast', data: { cardInstanceId: data.cardInstanceId, payment: data.payment, ...(Object.hasOwn(data, 'target') ? { target: data.target as SpellCastData['target'] } : {}), ...(Object.hasOwn(data, 'choice') ? { choice: data.choice as SpellCastData['choice'] } : {}), ...(Object.hasOwn(data, 'manaAmount') ? { manaAmount: Number(data.manaAmount) } : {}), ...(Object.hasOwn(data, 'healthAmount') ? { healthAmount: Number(data.healthAmount) } : {}) } } }
    }
    if (payload.action === 'choice.resolve') {
      const data = payload.data
      if (Object.keys(data).length !== 2 || typeof data.choiceId !== 'string' || data.choiceId.length < 1 || data.choiceId.length > 128 || !record(data.selection)) invalid()
      if (Object.hasOwn(data.selection, 'unitId')) {
        exactKeys(data.selection, ['unitId'])
        if (typeof data.selection.unitId !== 'string' || data.selection.unitId.length < 1 || data.selection.unitId.length > 128) invalid()
        return { type: 'game.command', payload: { ...identity, action: 'choice.resolve', data: { choiceId: data.choiceId, selection: { unitId: data.selection.unitId } } } }
      }
      if (Object.hasOwn(data.selection, 'cell')) {
        exactKeys(data.selection, ['cell'])
        if (!record(data.selection.cell)) invalid()
        exactKeys(data.selection.cell, ['row', 'col'])
        if (!Number.isInteger(data.selection.cell.row) || Number(data.selection.cell.row) < 0 || Number(data.selection.cell.row) > 4 || !Number.isInteger(data.selection.cell.col) || Number(data.selection.cell.col) < 0 || Number(data.selection.cell.col) > 4) invalid()
        return { type: 'game.command', payload: { ...identity, action: 'choice.resolve', data: { choiceId: data.choiceId, selection: { cell: { row: Number(data.selection.cell.row), col: Number(data.selection.cell.col) } } } } }
      }
      if (Object.hasOwn(data.selection, 'player')) {
        exactKeys(data.selection, ['player'])
        if (data.selection.player !== 'self' && data.selection.player !== 'opponent') invalid()
        return { type: 'game.command', payload: { ...identity, action: 'choice.resolve', data: { choiceId: data.choiceId, selection: { player: data.selection.player } } } }
      }
      if (Object.hasOwn(data.selection, 'tokenClass')) {
        exactKeys(data.selection, ['tokenClass'])
        if (!Number.isInteger(data.selection.tokenClass) || Number(data.selection.tokenClass) < 0 || Number(data.selection.tokenClass) > 5) invalid()
        return { type: 'game.command', payload: { ...identity, action: 'choice.resolve', data: { choiceId: data.choiceId, selection: { tokenClass: Number(data.selection.tokenClass) } } } }
      }
      if (Object.hasOwn(data.selection, 'choice')) {
        if (data.selection.choice === 'librarian-cost') {
          exactKeys(data.selection, ['choice', 'cost'])
          if (data.selection.cost !== 1 && data.selection.cost !== 2 && data.selection.cost !== 4) invalid()
          return { type: 'game.command', payload: { ...identity, action: 'choice.resolve', data: { choiceId: data.choiceId, selection: { choice: 'librarian-cost', cost: data.selection.cost } } } }
        }
        if (data.selection.choice === 'librarian-pile') {
          exactKeys(data.selection, ['choice', 'pile'])
          if (data.selection.pile !== 'deck' && data.selection.pile !== 'discard') invalid()
          return { type: 'game.command', payload: { ...identity, action: 'choice.resolve', data: { choiceId: data.choiceId, selection: { choice: 'librarian-pile', pile: data.selection.pile } } } }
        }
        exactKeys(data.selection, ['choice'])
        if (data.selection.choice !== 'draw' && data.selection.choice !== 'limit' && data.selection.choice !== 'mana' && data.selection.choice !== 'energy' && data.selection.choice !== 'viskas-draw' && data.selection.choice !== 'viskas-discard' && data.selection.choice !== 'swarm-draw' && data.selection.choice !== 'swarm-mana' && data.selection.choice !== 'keep' && data.selection.choice !== 'discard') invalid()
        return { type: 'game.command', payload: { ...identity, action: 'choice.resolve', data: { choiceId: data.choiceId, selection: { choice: data.selection.choice } } } }
      }
      exactKeys(data.selection, ['unitIds'])
      const unitIds = data.selection.unitIds
      if (!Array.isArray(unitIds) || unitIds.length > 128 || unitIds.some(id => typeof id !== 'string' || id.length < 1 || id.length > 128) || new Set(unitIds).size !== unitIds.length) invalid()
      return { type: 'game.command', payload: { ...identity, action: 'choice.resolve', data: { choiceId: data.choiceId, selection: { unitIds: [...unitIds] } } } }
    }
    invalid('UNSUPPORTED_ACTION')
  }
  invalid('UNSUPPORTED_MESSAGE')
}
