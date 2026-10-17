import type { Pool } from 'pg'
import { cardCatalog, RULES_VERSION } from '@bfw/game-data'

export async function seedCards(pool: Pool) {
  const ids = cardCatalog.map(card => card.Id)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const seed = cardCatalog.map(card => ({ id: card.Id, definition: card, playable: !card.Tags?.includes('в разработке') }))
    await client.query(`INSERT INTO cards(id,definition_json,rules_version,is_playable)
      SELECT id,definition,$2,playable FROM jsonb_to_recordset($1::jsonb) AS c(id uuid,definition jsonb,playable boolean)
      ON CONFLICT(id) DO UPDATE SET definition_json=EXCLUDED.definition_json,rules_version=EXCLUDED.rules_version,is_playable=EXCLUDED.is_playable`,
    [JSON.stringify(seed), RULES_VERSION])
    await client.query('UPDATE cards SET is_playable=false WHERE NOT (id = ANY($1::uuid[]))', [ids])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}
