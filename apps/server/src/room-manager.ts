import { readFileSync } from 'node:fs'
import { randomInt, randomUUID } from 'node:crypto'
import { getHeapStatistics } from 'node:v8'

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const OWNER_GRACE_MS = 15_000
const GUEST_GRACE_MS = 60_000

export type RoomProfile = { userId: string; username: string; displayName: string }
type Seat = RoomProfile & {
  deckId: string | null
  deckRevision: number | null
  ready: boolean
  connectionId: string | null
  disconnectedAt: number | null
}
type Room = {
  id: string
  code: string
  status: 'waiting' | 'playing'
  revision: number
  createdAt: number
  matchId: string | null
  owner: Seat
  guest: Seat | null
}
type Connection = { profile: RoomProfile; connectionId: string }
export type RoomView = {
  id: string; code: string; ownerUserId: string; status: 'waiting' | 'playing'; revision: number; matchId: string | null;
  participants: { userId: string; username: string; displayName: string; ready: boolean; connected: boolean }[];
  myDeckId: string | null; myDeckRevision: number | null; canStart: boolean
}
export type RoomUpdate = { userId: string; view: RoomView }
export class RoomError extends Error {
  readonly code: string
  constructor(code: string) { super(code); this.code = code }
}

function seat(profile: RoomProfile, connectionId: string): Seat {
  return { ...profile, deckId: null, deckRevision: null, ready: false, connectionId, disconnectedAt: null }
}

export function cgroupMemoryOverloaded(limitValue: string, usedValue: string) {
  if (!/^\d+$/u.test(limitValue.trim()) || !/^\d+$/u.test(usedValue.trim())) return null
  const limit = BigInt(limitValue.trim())
  const used = BigInt(usedValue.trim())
  if (limit <= 0n || limit >= 1n << 60n) return null
  return used * 100n >= limit * 85n
}

function containerMemoryOverloaded() {
  for (const [limitPath, usedPath] of [
    ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory.current'],
    ['/sys/fs/cgroup/memory/memory.limit_in_bytes', '/sys/fs/cgroup/memory/memory.usage_in_bytes'],
  ]) {
    try {
      const pressure = cgroupMemoryOverloaded(readFileSync(limitPath, 'utf8'), readFileSync(usedPath, 'utf8'))
      if (pressure !== null) return pressure
    } catch {}
  }
  return null
}

function heapOverloaded() {
  const containerPressure = containerMemoryOverloaded()
  if (containerPressure !== null) return containerPressure
  // shortcut: falls back to V8 heap when cgroup stats are unavailable, replace with a configured process limit outside containers.
  return process.memoryUsage().heapUsed >= getHeapStatistics().heap_size_limit * 0.85
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>()
  private readonly byCode = new Map<string, string>()
  private readonly byUser = new Map<string, string>()
  private readonly connections = new Map<string, Connection>()
  private readonly lifecycleEvents: { roomId: string; matchId: string | null; reason: string; ownerUserId: string; guestUserId: string | null }[] = []
  private readonly overloaded: () => boolean

  constructor(overloaded = heapOverloaded) { this.overloaded = overloaded }

  connectionAllowed(userId: string, now = Date.now()) {
    if (!this.overloaded()) return true
    const room = this.roomFor(userId)
    if (!room) return false
    const currentSeat = this.playerSeat(room, userId)
    return currentSeat.connectionId === null && currentSeat.disconnectedAt !== null
      && currentSeat.disconnectedAt + this.grace(room, currentSeat) > now
  }

  matchCommandsAllowed(userId: string, matchId: string) {
    const room = this.roomFor(userId)
    return !!room && room.status === 'playing' && room.matchId === matchId
      && !!room.owner.connectionId && !!room.guest?.connectionId
  }

  connect(profile: RoomProfile, connectionId: string, now = Date.now()) {
    if (!this.connectionAllowed(profile.userId, now)) throw new RoomError('SERVER_BUSY')
    const active = this.connections.get(profile.userId)
    if (active && active.connectionId !== connectionId) throw new RoomError('ACTIVE_CONNECTION_EXISTS')
    let room = this.roomFor(profile.userId)
    if (room) {
      const currentSeat = this.playerSeat(room, profile.userId)
      const deadline = currentSeat.disconnectedAt === null ? null : currentSeat.disconnectedAt + this.grace(room, currentSeat)
      if (deadline !== null && deadline <= now) {
        this.expire(room, now)
        room = null
      } else {
        if (currentSeat.connectionId) throw new RoomError('ACTIVE_CONNECTION_EXISTS')
        currentSeat.connectionId = connectionId
        currentSeat.disconnectedAt = null
        if (room.status === 'waiting' && currentSeat === room.owner) currentSeat.ready = false
        room.revision++
      }
    }
    this.connections.set(profile.userId, { profile, connectionId })
    return room ? this.view(room, profile.userId) : null
  }

  disconnect(userId: string, connectionId: string, now = Date.now()) {
    const connection = this.connections.get(userId)
    if (!connection || connection.connectionId !== connectionId) return null
    this.connections.delete(userId)
    const room = this.roomFor(userId)
    if (!room) return null
    const currentSeat = this.playerSeat(room, userId)
    currentSeat.connectionId = null
    currentSeat.disconnectedAt = now
    currentSeat.ready = false
    room.revision++
    return {
      roomId: room.id, deadline: now + this.grace(room, currentSeat), status: room.status, matchId: room.matchId,
      ownerUserId: room.owner.userId, guestUserId: room.guest?.userId ?? null, updates: this.updates(room),
    }
  }

  create(userId: string, now = Date.now()) {
    const connection = this.connections.get(userId)
    if (!connection) throw new RoomError('PLAYER_OFFLINE')
    const existing = this.roomFor(userId)
    if (existing) return { room: this.view(existing, userId), created: false }
    if (this.overloaded()) throw new RoomError('SERVER_BUSY')
    const code = this.newCode()
    const room: Room = {
      id: randomUUID(), code, status: 'waiting', revision: 1, createdAt: now, matchId: null,
      owner: seat(connection.profile, connection.connectionId), guest: null,
    }
    this.rooms.set(room.id, room)
    this.byCode.set(code, room.id)
    this.byUser.set(userId, room.id)
    return { room: this.view(room, userId), created: true }
  }

  join(userId: string, inputCode: string, now = Date.now()) {
    const connection = this.connections.get(userId)
    if (!connection) throw new RoomError('PLAYER_OFFLINE')
    const code = inputCode.trim().toUpperCase()
    const existing = this.roomFor(userId)
    if (existing) {
      if (existing.code !== code) throw new RoomError('ALREADY_IN_ROOM')
      return this.view(existing, userId)
    }
    const roomId = this.byCode.get(code)
    const room = roomId ? this.rooms.get(roomId) : undefined
    if (!room) throw new RoomError('ROOM_NOT_FOUND')
    if (room.status !== 'waiting') throw new RoomError('ROOM_ALREADY_PLAYING')
    if (!room.owner.connectionId) throw new RoomError('PLAYER_OFFLINE')
    if (room.owner.userId === userId) throw new RoomError('CANNOT_JOIN_SELF')
    if (room.guest) throw new RoomError('ROOM_FULL')
    if (this.overloaded()) throw new RoomError('SERVER_BUSY')
    room.guest = seat(connection.profile, connection.connectionId)
    room.revision++
    this.byUser.set(userId, room.id)
    return this.view(room, userId)
  }

  selectDeck(userId: string, deckId: string, revision: number, playable: boolean, expectedRoomId?: string) {
    const room = this.requireRoom(userId, expectedRoomId)
    if (room.status !== 'waiting') throw new RoomError('ROOM_ALREADY_PLAYING')
    if (!playable) throw new RoomError('DECK_NOT_PLAYABLE')
    const currentSeat = this.playerSeat(room, userId)
    currentSeat.deckId = deckId
    currentSeat.deckRevision = revision
    currentSeat.ready = false
    room.revision++
    return this.view(room, userId)
  }

  setReady(userId: string, ready: boolean, currentDeckRevision?: number, expectedRoomId?: string) {
    const room = this.requireRoom(userId, expectedRoomId)
    if (room.status !== 'waiting') throw new RoomError('ROOM_ALREADY_PLAYING')
    const currentSeat = this.playerSeat(room, userId)
    if (!ready) currentSeat.ready = false
    else {
      if (!currentSeat.deckId || currentSeat.deckRevision === null) throw new RoomError('DECK_NOT_SELECTED')
      if (currentSeat.deckRevision !== currentDeckRevision) {
        currentSeat.ready = false
        room.revision++
        throw new RoomError('DECK_CHANGED')
      }
      if (!currentSeat.connectionId) throw new RoomError('PLAYER_OFFLINE')
      currentSeat.ready = true
    }
    room.revision++
    return this.view(room, userId)
  }

  start(userId: string, matchId: string, expectedRoomId?: string) {
    const room = this.requireRoom(userId, expectedRoomId)
    if (room.owner.userId !== userId) throw new RoomError('OWNER_ONLY')
    if (room.status === 'playing' && room.matchId) return { matchId: room.matchId, updates: this.updates(room) }
    if (!room.guest || !room.owner.ready || !room.guest.ready) throw new RoomError('PLAYERS_NOT_READY')
    if (!room.owner.connectionId || !room.guest.connectionId) throw new RoomError('PLAYER_OFFLINE')
    room.status = 'playing'
    room.matchId = matchId
    room.revision++
    return { matchId, updates: this.updates(room) }
  }

  finishMatch(userId: string, matchId: string) {
    const room = this.roomFor(userId)
    if (!room || room.matchId !== matchId || room.status !== 'playing') return []
    room.status = 'waiting'
    room.matchId = null
    room.owner.ready = false
    if (room.guest) room.guest.ready = false
    room.revision++
    return this.updates(room)
  }

  leave(userId: string, expectedRoomId?: string) {
    const room = this.roomFor(userId)
    if (!room) return { status: 204 as const, roomId: null, endedMatchId: null, closedUserIds: [] as string[], updates: [] as RoomUpdate[] }
    if (expectedRoomId && room.id !== expectedRoomId) throw new RoomError('ROOM_NOT_FOUND')
    const endedMatchId = room.status === 'playing' ? room.matchId : null
    if (room.owner.userId === userId) {
      this.removeRoom(room)
      return { status: 204 as const, roomId: room.id, endedMatchId, closedUserIds: room.guest ? [room.guest.userId] : [], updates: [] as RoomUpdate[] }
    }
    room.guest = null
    this.byUser.delete(userId)
    room.status = 'waiting'
    room.matchId = null
    room.owner.ready = false
    room.revision++
    return { status: 204 as const, roomId: room.id, endedMatchId, closedUserIds: [userId], updates: this.updates(room) }
  }

  expireDisconnected(now = Date.now()) {
    for (const room of this.rooms.values()) this.expire(room, now)
    return this.takeLifecycleEvents()
  }

  takeLifecycleEvents() { return this.lifecycleEvents.splice(0) }

  current(userId: string) {
    const room = this.roomFor(userId)
    return room ? this.view(room, userId) : null
  }

  roomUpdates(roomId: string) {
    const room = this.rooms.get(roomId)
    return room ? this.updates(room) : []
  }

  private expire(room: Room, now: number): { roomId: string; matchId: string | null; reason: string; ownerUserId: string; guestUserId: string | null } | null {
    if (room.owner.disconnectedAt !== null && room.owner.disconnectedAt + OWNER_GRACE_MS <= now) {
      const event = { roomId: room.id, matchId: room.matchId, reason: 'owner_disconnected', ownerUserId: room.owner.userId, guestUserId: room.guest?.userId ?? null }
      this.lifecycleEvents.push(event)
      this.removeRoom(room)
      return event
    }
    if (room.guest && room.guest.disconnectedAt !== null && room.guest.disconnectedAt + GUEST_GRACE_MS <= now) {
      const event = { roomId: room.id, matchId: room.matchId, reason: 'guest_disconnected', ownerUserId: room.owner.userId, guestUserId: room.guest.userId }
      this.lifecycleEvents.push(event)
      this.byUser.delete(room.guest.userId)
      room.guest = null
      room.status = 'waiting'
      room.matchId = null
      room.owner.ready = false
      room.revision++
      return event
    }
    return null
  }

  private grace(room: Room, currentSeat: Seat) { return currentSeat === room.owner ? OWNER_GRACE_MS : GUEST_GRACE_MS }
  private requireRoom(userId: string, expectedRoomId?: string) {
    const room = this.roomFor(userId)
    if (!room || expectedRoomId && room.id !== expectedRoomId) throw new RoomError('ROOM_NOT_FOUND')
    return room
  }
  private roomFor(userId: string) {
    const roomId = this.byUser.get(userId)
    return roomId ? this.rooms.get(roomId) ?? null : null
  }
  private playerSeat(room: Room, userId: string) {
    if (room.owner.userId === userId) return room.owner
    if (room.guest?.userId === userId) return room.guest
    throw new RoomError('ROOM_NOT_FOUND')
  }
  private updates(room: Room): RoomUpdate[] {
    return [room.owner, room.guest].filter((player): player is Seat => !!player).map(player => ({ userId: player.userId, view: this.view(room, player.userId) }))
  }
  private view(room: Room, userId: string): RoomView {
    const currentSeat = this.playerSeat(room, userId)
    return {
      id: room.id, code: room.code, ownerUserId: room.owner.userId, status: room.status,
      revision: room.revision, matchId: room.matchId,
      participants: [room.owner, room.guest].filter((player): player is Seat => !!player).map(player => ({
        userId: player.userId, username: player.username, displayName: player.displayName,
        ready: player.ready, connected: !!player.connectionId,
      })),
      myDeckId: currentSeat.deckId, myDeckRevision: currentSeat.deckRevision,
      canStart: room.owner.userId === userId && room.status === 'waiting' && !!room.guest
        && room.owner.ready && room.guest.ready && !!room.owner.connectionId && !!room.guest.connectionId,
    }
  }
  private newCode() {
    let code: string
    do { code = Array.from({ length: 8 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('') }
    while (this.byCode.has(code))
    return code
  }
  private removeRoom(room: Room) {
    this.rooms.delete(room.id)
    this.byCode.delete(room.code)
    this.byUser.delete(room.owner.userId)
    if (room.guest) this.byUser.delete(room.guest.userId)
  }
}
