// Optional Supabase persistence, so a container host can lose its disk and the studio comes back identical.
//   records  -> public.records table (one row per record, jsonb)      collections: products, reels, characters...
//   files    -> private Storage bucket `files` (mirror of data/files) footage, audio, covers, MP4s
// The app still works on local disk exactly as before; this only mirrors it. Off unless both variables are set:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (the secret key from Project Settings -> API Keys. Never put it in the browser.)
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { FILES } from './env.ts'

const url = (process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
const BUCKET = (process.env.SUPABASE_BUCKET ?? 'files').trim()

export const cloudEnabled = url.length > 0 && key.length > 0
const headers = (extra: Record<string, string> = {}) => ({ apikey: key, authorization: `Bearer ${key}`, ...extra })
const say = (m: string) => console.log(`[cloud] ${m}`)
/** A request that never answers would otherwise stall every later save or upload, so each one gets a deadline. */
const timed = (bytes = 0) => AbortSignal.timeout(60_000 + Math.round(bytes / 100_000) * 1000)

async function check(res: Response, what: string): Promise<Response> {
  if (res.ok) return res
  const body = (await res.text().catch(() => '')).slice(0, 300)
  throw new Error(`Supabase ${what} failed (${res.status}): ${body}`)
}

// ---------- Records ----------
export async function loadRecords<T>(collection: string): Promise<T[]> {
  const out: T[] = []
  for (let offset = 0; ; offset += 1000) {
    const res = await check(await fetch(`${url}/rest/v1/records?collection=eq.${encodeURIComponent(collection)}&select=data&order=seq.asc&limit=1000&offset=${offset}`, { headers: headers(), signal: timed() }), `read ${collection}`)
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
    await check(await fetch(`${url}/rest/v1/records?on_conflict=collection,id`, { method: 'POST', headers: headers({ 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' }), body, signal: timed(body.length) }), `save ${collection}`)
  })
}

export function deleteRecord(collection: string, id: string) {
  if (!cloudEnabled) return
  enqueue(`delete ${collection}`, async () => {
    await check(await fetch(`${url}/rest/v1/records?collection=eq.${encodeURIComponent(collection)}&id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: headers(), signal: timed() }), `delete ${collection}`)
  })
}

// ---------- Files ----------
const objectUrl = (path: string) => `${url}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`
const toKey = (abs: string) => relative(FILES, abs).split(sep).join('/')

// Storage rejects single uploads above the project's size limit (50 MB by default), so bigger files
// (rendered MP4s) are stored as `<key>.part-<i>-of-<n>` and joined again on restore.
const PART_BYTES = 40 * 1024 * 1024
const PART_RE = /^(.+)\.part-(\d+)-of-(\d+)$/
const partNames = (k: string, n: number) => (n === 1 ? [k] : Array.from({ length: n }, (_, i) => `${k}.part-${i + 1}-of-${n}`))

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
    const res = await check(await fetch(`${url}/storage/v1/object/list/${BUCKET}`, { method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }), signal: timed() }), 'list files')
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
/** The bucket objects each key is stored as (one name, or its parts). */
const stored = new Map<string, string[]>()
/** Uploads that failed, so a file that keeps failing is retried every few minutes rather than every pass. */
const failed = new Map<string, { sig: string; at: number }>()
const RETRY_MS = 5 * 60_000
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function download(name: string): Promise<Buffer> {
  const res = await check(await fetch(objectUrl(name), { headers: headers(), signal: timed(PART_BYTES) }), `download ${name}`)
  return Buffer.from(await res.arrayBuffer())
}

async function upload(k: string, path: string): Promise<void> {
  const data = readFileSync(path)
  const names = partNames(k, Math.max(1, Math.ceil(data.length / PART_BYTES)))
  for (const [i, name] of names.entries()) {
    const body = names.length === 1 ? data : data.subarray(i * PART_BYTES, (i + 1) * PART_BYTES)
    await check(await fetch(objectUrl(name), { method: 'POST', headers: headers({ 'x-upsert': 'true', 'content-type': 'application/octet-stream' }), body, signal: timed(body.length) }), `upload ${name}`)
  }
  const stale = (stored.get(k) ?? []).filter((n) => !names.includes(n))
  if (stale.length) await removeRemote(stale)
  stored.set(k, names)
}

async function removeRemote(names: string[]): Promise<void> {
  for (let i = 0; i < names.length; i += 100) {
    await check(await fetch(`${url}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify({ prefixes: names.slice(i, i + 100) }), signal: timed() }), 'delete files')
  }
}

/** Pulls everything from the bucket that this disk is missing. Run once at start-up; never throws. */
export async function restoreFiles(): Promise<void> {
  if (!cloudEnabled) return
  let names: string[]
  try {
    names = await listRemote()
  } catch (e) {
    say(`file restore skipped: ${message(e)}`)
    return
  }
  const groups = new Map<string, string[]>()
  for (const name of names) {
    const k = PART_RE.exec(name)?.[1] ?? name
    groups.set(k, [...(groups.get(k) ?? []), name])
  }
  let got = 0
  let bad = 0
  for (const [k, have] of groups) {
    stored.set(k, have)
    const total = Number(have.map((n) => PART_RE.exec(n)?.[3]).find(Boolean) ?? 1)
    const want = have.includes(k) ? [k] : partNames(k, total)
    const dest = join(FILES, ...k.split('/'))
    try {
      if (!existsSync(dest)) {
        if (!want.every((n) => have.includes(n))) throw new Error(`only ${have.length} of ${want.length} parts are stored`)
        const parts: Buffer[] = []
        for (const n of want) parts.push(await download(n))
        mkdirSync(dirname(dest), { recursive: true })
        writeFileSync(dest + '.tmp', Buffer.concat(parts))
        renameSync(dest + '.tmp', dest)
        got++
      }
      const st = statSync(dest)
      synced.set(k, `${st.size}:${Math.round(st.mtimeMs)}`)
    } catch (e) {
      bad++
      say(`restore ${k}: ${message(e)}`)
    }
  }
  say(`files restored: ${got} downloaded, ${groups.size - got - bad} already on disk${bad ? `, ${bad} failed` : ''}`)
}

let syncing: Promise<void> | null = null
let again = false
const status = { lastSyncAt: 0, lastUploadAt: 0, uploaded: 0, failing: 0, lastError: '' }

/** Uploads new or changed files and removes ones deleted locally. Safe to call often. */
export function syncFiles(): Promise<void> {
  if (!cloudEnabled) return Promise.resolve()
  if (syncing) { again = true; return syncing }
  // A pass with nothing to do finishes synchronously, so the reset has to happen in a later tick than this assignment.
  syncing = syncPass().finally(() => {
    syncing = null
    if (again) { again = false; void syncFiles() }
  })
  return syncing
}

async function syncPass(): Promise<void> {
  try {
    const local = new Map(walkLocal(FILES).map((p) => [toKey(p), p]))
    let up = 0
    let errors = 0
    for (const [k, p] of local) {
      const st = statSync(p, { throwIfNoEntry: false })
      if (!st) continue
      const sig = `${st.size}:${Math.round(st.mtimeMs)}`
      if (synced.get(k) === sig) continue
      const f = failed.get(k)
      if (f && f.sig === sig && Date.now() - f.at < RETRY_MS) continue
      try {
        await upload(k, p)
        synced.set(k, sig)
        failed.delete(k)
        up++
      } catch (e) {
        failed.set(k, { sig, at: Date.now() })
        errors++
        status.lastError = `upload ${k}: ${message(e)}`
        say(status.lastError)
      }
    }
    const gone = [...synced.keys()].filter((k) => !local.has(k))
    if (gone.length) {
      await removeRemote(gone.flatMap((k) => stored.get(k) ?? [k]))
      for (const k of gone) { synced.delete(k); stored.delete(k) }
    }
    if (up || gone.length || errors) say(`files synced: ${up} uploaded, ${gone.length} removed${errors ? `, ${errors} failed` : ''}`)
    status.uploaded += up
    if (up) status.lastUploadAt = Date.now()
  } catch (e) {
    status.lastError = message(e)
    say(`file sync: ${status.lastError}`)
  } finally {
    status.lastSyncAt = Date.now()
    status.failing = failed.size
  }
}

/** For /healthz: proves the mirror is still moving. */
export const syncStatus = () => (cloudEnabled ? { ...status, syncing: !!syncing, known: synced.size } : null)

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
  // On a restart or deploy the host sends SIGTERM and gives a few seconds: send what is pending, then go.
  const flush = () => {
    setTimeout(() => process.exit(0), 8000).unref()
    void Promise.all([queue, syncFiles()]).finally(() => process.exit(0))
  }
  process.once('SIGTERM', flush)
  process.once('SIGINT', flush)
}

export const cloudInfo = () => (cloudEnabled ? { url, bucket: BUCKET } : null)
