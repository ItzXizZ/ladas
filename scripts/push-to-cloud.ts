// One-off: copies this machine's data/ (records and files) up to Supabase, so a hosted copy of the studio
// shows the same projects, reels and videos. Existing records with the same id are replaced; nothing is deleted.
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run cloud:push
// Restart the hosted service afterwards so it reads the new data.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cloudEnabled, flushRecords, syncFiles, upsertRecords } from '../server/cloud.ts'
import { DB } from '../server/env.ts'

if (!cloudEnabled) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.')
  process.exit(1)
}

for (const name of ['products', 'characters', 'character-history', 'casts', 'reels', 'settings']) {
  const file = join(DB, `${name}.json`)
  if (!existsSync(file)) continue
  const items = JSON.parse(readFileSync(file, 'utf8')) as { id: string }[]
  console.log(`records: ${name} (${items.length})`)
  upsertRecords(name, items)
}
await flushRecords()
console.log('records sent. Uploading files...')
await syncFiles()
console.log('done')
process.exit(0)
