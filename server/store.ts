// File-backed store: one JSON file per collection. Single user, single process, so a write-through
// cache with atomic replace is enough. Every record is plain data that maps 1:1 to shared/types.
// With Supabase configured (see cloud.ts) every change is mirrored there and the records are read
// back from it at start-up, so the data outlives the host's disk.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, STARTER_CASTS, STARTER_CHARACTERS } from '../shared/starter.ts'
import type { AppSettings, Cast, CharacterRecord, Product, Reel, ReelBundle } from '../shared/types.ts'
import { cloudEnabled, deleteRecord, loadRecords, upsertRecords } from './cloud.ts'
import { DB } from './env.ts'

class Collection<T extends { id: string }> {
  private items: T[]
  private file: string
  private name: string
  private constructor(name: string, items: T[]) {
    this.name = name
    this.file = join(DB, `${name}.json`)
    this.items = items
    this.flush()
  }
  /** Cloud records win when there are any; otherwise the local file; otherwise the seed. */
  static async open<T extends { id: string }>(name: string, seed: T[] = []): Promise<Collection<T>> {
    const file = join(DB, `${name}.json`)
    let local: T[] | undefined
    if (existsSync(file)) {
      try {
        local = JSON.parse(readFileSync(file, 'utf8')) as T[]
      } catch (e) {
        // Never silently replace a corrupt database with seed data.
        throw new Error(`Could not read ${file}: ${String(e)}. Fix or remove the file and restart.`)
      }
    }
    if (!cloudEnabled) return new Collection<T>(name, local ?? seed)
    const remote = await loadRecords<T>(name)
    if (remote.length) return new Collection<T>(name, remote)
    const items = local ?? seed
    upsertRecords(name, items)
    return new Collection<T>(name, items)
  }
  private flush() {
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(this.items, null, 1))
    renameSync(tmp, this.file)
  }
  all(): T[] {
    return this.items
  }
  get(id: string): T | undefined {
    return this.items.find((i) => i.id === id)
  }
  put(item: T): T {
    const i = this.items.findIndex((x) => x.id === item.id)
    if (i >= 0) this.items[i] = item
    else this.items.push(item)
    this.flush()
    upsertRecords(this.name, [item])
    return item
  }
  remove(id: string): boolean {
    const n = this.items.length
    this.items = this.items.filter((i) => i.id !== id)
    if (this.items.length !== n) {
      this.flush()
      deleteRecord(this.name, id)
    }
    return this.items.length !== n
  }
}

type Versioned = CharacterRecord & { id: string }

export const db = {
  products: await Collection.open<Product>('products'),
  characters: await Collection.open<CharacterRecord>('characters', STARTER_CHARACTERS),
  /** Every past version of every character, keyed `${id}@${version}`. */
  characterHistory: await Collection.open<Versioned>('character-history'),
  casts: await Collection.open<Cast>('casts', STARTER_CASTS),
  reels: await Collection.open<Reel>('reels'),
  settings: await Collection.open<AppSettings & { id: string }>('settings', [{ id: 'app', ...DEFAULT_SETTINGS }]),
}

export function getSettings(): AppSettings {
  const { id: _id, ...rest } = db.settings.get('app') ?? { id: 'app', ...DEFAULT_SETTINGS }
  return { ...DEFAULT_SETTINGS, ...rest }
}
export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...patch }
  db.settings.put({ id: 'app', ...next })
  return next
}

/** Saving an edit creates a new version; the old one is kept so old reels keep their look. */
export function saveCharacter(rec: CharacterRecord): CharacterRecord {
  const prev = db.characters.get(rec.id)
  const now = new Date().toISOString()
  if (prev) {
    db.characterHistory.put({ ...prev, id: `${prev.id}@${prev.version}` })
    return db.characters.put({ ...rec, version: prev.version + 1, createdAt: prev.createdAt, updatedAt: now })
  }
  return db.characters.put({ ...rec, version: 1, createdAt: now, updatedAt: now })
}

function characterAt(id: string, version: number | undefined): CharacterRecord | undefined {
  const cur = db.characters.get(id)
  if (!cur || version === undefined || cur.version === version) return cur
  const old = db.characterHistory.get(`${id}@${version}`)
  return old ? { ...old, id } : cur
}

export function bundleFor(reel: Reel): ReelBundle {
  const product = db.products.get(reel.productId)
  if (!product) throw new Error(`Reel ${reel.id} points at a product that no longer exists`)
  const characters = reel.characterIds
    .map((id) => characterAt(id, reel.characterVersions[id]))
    .filter((c): c is CharacterRecord => !!c)
  return { reel, product, characters }
}

export function saveReel(reel: Reel): Reel {
  return db.reels.put({ ...reel, updatedAt: new Date().toISOString() })
}
