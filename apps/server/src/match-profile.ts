import type { Pool } from 'pg'
import { projectForPlayer, type MatchState } from '@bfw/game-core'
import { avatarUrl } from './avatar-routes.ts'

type PublicAvatar = { seat: number; user_id: string; avatar_version: number; has_avatar: boolean }

export async function projectMatchForPlayer(pool: Pick<Pool, 'query'>, matchId: string, state: MatchState, seat: number) {
  const snapshot = projectForPlayer(state, seat)
  const { rows } = await pool.query<PublicAvatar>(
    `SELECT mp.seat,mp.user_id,u.avatar_version,
       EXISTS(SELECT 1 FROM user_avatars a WHERE a.user_id=mp.user_id) AS has_avatar
     FROM match_players mp JOIN users u ON u.id=mp.user_id
     WHERE mp.match_id=$1 ORDER BY mp.seat`, [matchId],
  )
  const avatars = new Map(rows.map(profile => [profile.seat, profile]))
  return {
    ...snapshot,
    public: {
      ...snapshot.public,
      players: snapshot.public.players.map((player, playerSeat) => {
        const profile = avatars.get(playerSeat)
        return { ...player, avatarUrl: profile?.has_avatar ? avatarUrl(profile.user_id, profile.avatar_version) : null }
      }),
    },
  }
}
