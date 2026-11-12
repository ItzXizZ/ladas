// Optional Supabase persistence, so a container host can lose its disk and the studio comes back identical.
//   records  -> public.records table (one row per record, jsonb)      collections: products, reels, characters...
//   files    -> private Storage bucket `files` (mirror of data/files) footage, audio, covers, MP4s
// The app still works on local disk exactly as before; this only mirrors it. Off unless both variables are set:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (the secret key from Project Settings -> API Keys. Never put it in the browser.)
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { FILES } from './env.ts'

const url = (process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
const BUCKET = (process.env.SUPABASE_BUCKET ?? 'files').trim()

export const cloudEnabled = url.length > 0 && key.length > 0
const headers = (extra: Record<string, string> = {}) => ({ apikey: key, authorization: `Bearer ${key}`, ...extra })
const say = (m: string) => console.log(`[cloud] ${m}`)

async function check(res: Response, what: string): Promise<Response> {
  if (res.ok) return res
  const body = (await res.text().catch(() => '')).slice(0, 300)
  throw new Error(`Supabase ${what} failed (${res.status}): ${body}`)
}

// ---------- Records ----------
export async function loadRecords<T>(collection: string): Promise<T[]> {
  const out: T[] = []
  for (let offset = 0; ; offset += 1000) {
    const res = await check(await fetch(`${url}/rest/v1/records?collection=eq.${encodeURIComponent(collection)}&select=data&order=seq.asc&limit=1000&offset=${offset}`, { headers: headers() }), `read ${collection}`)
    const rows = (await res.json()) as { data: T }[]
    out.push(...rows.map((r) => r.data))
    if (rows.length < 1000) return out
  }
}

// Writes go through one queue, in order, so a slow request can never overwrite a newer save.
let queue: Promise<unknown> = Promise.resolve()
const enqueue = (what: string, run: () => Promise<unknown>) => {
  queue = queue.then(run).catch((e: unknown) => say(`${what}: ${e instanceof Error ? e.message : String(e)}`))
}

/** Resolves once every queued record write has been sent. */
export const flushRecords = () => queue

export function upsertRecords(collection: string, items: { id: string }[]) {
  if (!cloudEnabled || !items.length) return
  const body = JSON.stringify(items.map((data) => ({ collection, id: data.id, data, updated_at: new Date().toISOString() })))
  enqueue(`save ${collection}`, async () => {
    await check(await fetch(`${url}/rest/v1/records?on_conflict=collection,id`, { method: 'POST', headers: headers({ 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' }), body }), `save ${collection}`)
  })
}

export function deleteRecord(collection: string, id: string) {
  if (!cloudEnabled) return
  enqueue(`delete ${collection}`, async () => {
    await check(await fetch(`${url}/rest/v1/records?collection=eq.${encodeURIComponent(collection)}&id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: headers() }), `delete ${collection}`)
  })
}

// ---------- Files ----------
const objectUrl = (path: string) => `${url}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`
const toKey = (abs: string) => relative(FILES, abs).split(sep).join('/')

function walkLocal(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walkLocal(p, out)
    else if (e.isFile() && !e.name.endsWith('.tmp')) out.push(p)
  }
  return out
}

async function listRemote(prefix = '', out: string[] = []): Promise<string[]> {
  for (let offset = 0; ; offset += 100) {
    const res = await check(await fetch(`${url}/storage/v1/object/list/${BUCKET}`, { method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }) }), 'list files')
    const rows = (await res.json()) as { name: string; id: string | null }[]
    for (const r of rows) {
      const path = prefix ? `${prefix}/${r.name}` : r.name
      if (r.id === null) await listRemote(path, out)
      else out.push(path)
    }
    if (rows.length < 100) return out
  }
}

/** What the bucket is known to hold: key -> "size:mtime" of the local file it was uploaded from. */
const synced = new Map<string, string>()

/** Pulls everything from the bucket that this disk is missing. Run once at start-up. */
export async function restoreFiles(): Promise<void> {
  if (!cloudEnabled) return
  const keys = await listRemote()
  let got = 0
  for (const k of keys) {
    const dest = join(FILES, ...k.split('/'))
    if (!existsSync(dest)) {
      const res = await check(await fetch(objectUrl(k), { headers: headers() }), `download ${k}`)
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
      got++
    }
    const st = statSync(dest)
    synced.set(k, `${st.size}:${Math.round(st.mtimeMs)}`)
  }
  say(`files restored: ${got} downloaded, ${keys.length - got} already on disk`)
}

let syncing: Promise<void> | null = null
let again = false

/** Uploads new or changed files and removes ones deleted locally. Safe to call often. */
export function syncFiles(): Promise<void> {
  if (!cloudEnabled) return Promise.resolve()
  if (syncing) { again = true; return syncing }
  syncing = (async () => {
    try {
      const local = new Map(walkLocal(FILES).map((p) => [toKey(p), p]))
      let up = 0
      for (const [k, p] of local) {
        const st = statSync(p)
        const sig = `${st.size}:${Math.round(st.mtimeMs)}`
        if (synced.get(k) === sig) continue
        await check(await fetch(objectUrl(k), { method: 'POST', headers: headers({ 'x-upsert': 'true', 'content-type': 'application/octet-stream' }), body: readFileSync(p) }), `upload ${k}`)
        synced.set(k, sig)
        up++
      }
      const gone = [...synced.keys()].filter((k) => !local.has(k))
      for (let i = 0; i < gone.length; i += 100) {
        const batch = gone.slice(i, i + 100)
        await check(await fetch(`${url}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify({ prefixes: batch }) }), 'delete files')
        for (const k of batch) synced.delete(k)
      }
      if (up || gone.length) say(`files synced: ${up} uploaded, ${gone.length} removed`)
    } catch (e) {
      say(`file sync: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      syncing = null
      if (again) { again = false; void syncFiles() }
    }
  })()
  return syncing
}

let timer: NodeJS.Timeout | undefined
/** Debounced: call after anything that writes to data/files. */
export function scheduleFileSync(delayMs = 2000) {
  if (!cloudEnabled) return
  clearTimeout(timer)
  timer = setTimeout(() => void syncFiles(), delayMs)
  timer.unref()
}

export function startCloud() {
  if (!cloudEnabled) return
  setInterval(() => void syncFiles(), 30_000).unref()
  const flush = () => { void Promise.all([queue, syncFiles()]).finally(() => process.exit(0)) }
  process.once('SIGTERM', flush)
  process.once('SIGINT', flush)
}

export const cloudInfo = () => (cloudEnabled ? { url, bucket: BUCKET } : null)
