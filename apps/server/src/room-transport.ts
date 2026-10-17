type WebSocket = { readyState: number; bufferedAmount?: number; send: (data: string) => void; close: (code?: number, reason?: string) => void }
import type { RoomUpdate } from './room-manager.ts'

export function sendSocketMessage(socket: WebSocket, type: string, payload: unknown, metadata: Record<string, unknown> = {}) {
  if (socket.readyState !== 1) return
  const message = JSON.stringify({ type, ...metadata, payload })
  const size = Buffer.byteLength(message)
  if (size > 1_048_576) { socket.close(1009, 'message too large'); return }
  if ((socket.bufferedAmount ?? 0) + size > 2_097_152) { socket.close(1013, 'slow client'); return }
  socket.send(message)
}

export class RoomTransport {
  private readonly sockets = new Map<string, WebSocket>()

  attach(userId: string, socket: WebSocket) { this.sockets.set(userId, socket) }
  detach(userId: string, socket: WebSocket) {
    if (this.sockets.get(userId) === socket) this.sockets.delete(userId)
  }
  send(userId: string, type: string, payload: unknown, metadata: Record<string, unknown> = {}) {
    const socket = this.sockets.get(userId)
    if (socket) sendSocketMessage(socket, type, payload, metadata)
  }
  publish(updates: readonly RoomUpdate[]) {
    for (const update of updates) this.send(update.userId, 'room.updated', update.view)
  }
  close(userId: string, code = 4001, reason = 'session expired') {
    const socket = this.sockets.get(userId)
    if (socket?.readyState === 1) socket.close(code, reason)
  }
}
