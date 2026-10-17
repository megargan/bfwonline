type VersionedSnapshot = { public: { id: string; version: number } }
type VersionedRoom = { id: string; revision: number }

export function shouldApplyRoomView(current: VersionedRoom | null, candidate: VersionedRoom) {
  return current?.id !== candidate.id || candidate.revision >= current.revision
}

export function shouldApplyMatchSnapshot(roomMatchId: string | null, current: VersionedSnapshot | null, candidate: VersionedSnapshot) {
  return candidate.public.id === roomMatchId && !(current?.public.id === candidate.public.id && candidate.public.version < current.public.version)
}
