// How close the container is to its memory limit. Hosts kill the whole service when it is crossed,
// so long jobs check this and back off before that happens. Reads cgroup v2, then v1; null elsewhere.
import { readFileSync } from 'node:fs'

const read = (p: string) => { try { return readFileSync(p, 'utf8') } catch { return null } }

function stat(text: string | null, keys: string[]): number | null {
  if (!text) return null
  for (const k of keys) {
    const m = new RegExp(`^${k} (\\d+)$`, 'm').exec(text)
    if (m) return Number(m[1])
  }
  return null
}

export interface MemoryInfo {
  limitMB: number
  /** Memory the kernel cannot reclaim: process memory plus files in RAM-backed folders. Page cache is left out. */
  usedMB: number
  shmemMB: number
  pressure: number
}

export function containerMemory(): MemoryInfo | null {
  const v2 = read('/sys/fs/cgroup/memory.max')
  const limitRaw = v2 !== null ? v2.trim() : read('/sys/fs/cgroup/memory/memory.limit_in_bytes')?.trim()
  const limit = Number(limitRaw)
  if (!limit || !isFinite(limit) || limit > 2 ** 50) return null
  const s = v2 !== null ? read('/sys/fs/cgroup/memory.stat') : read('/sys/fs/cgroup/memory/memory.stat')
  const anon = stat(s, ['anon', 'total_rss', 'rss'])
  if (anon === null) return null
  const shmem = stat(s, ['shmem', 'total_shmem']) ?? 0
  const used = anon + shmem
  const mb = (b: number) => Math.round(b / 1048576)
  return { limitMB: mb(limit), usedMB: mb(used), shmemMB: mb(shmem), pressure: used / limit }
}
