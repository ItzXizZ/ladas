// Talks to the local server. Long tasks come back as jobs; useJob follows one until it ends.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Job } from '../shared/types.ts'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** The server is restarting or too busy to answer: 502, 503, 504 from the host, or no response at all. */
const UNAVAILABLE = 'The server is not answering right now. It may be restarting; wait a minute and try again.'

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, UNAVAILABLE)
  }
  const text = await res.text()
  let data: unknown = null
  try { data = text ? JSON.parse(text) : null } catch { /* not JSON */ }
  if (!res.ok) {
    const fromServer = (data as { error?: string } | null)?.error
    throw new ApiError(res.status, fromServer ?? (res.status >= 502 && res.status <= 504 ? UNAVAILABLE : `Request failed (${res.status})`))
  }
  return data as T
}
export const get = <T,>(path: string) => api<T>('GET', path)
export const post = <T,>(path: string, body: unknown = {}) => api<T>('POST', path, body)
export const patch = <T,>(path: string, body: unknown) => api<T>('PATCH', path, body)
export const put = <T,>(path: string, body: unknown) => api<T>('PUT', path, body)
export const del = <T,>(path: string) => api<T>('DELETE', path)

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

// Jobs outlive the screen that started them, so their ids are kept here by purpose.
const running = new Map<string, string>()
export const trackJob = (key: string, jobId: string) => { running.set(key, jobId) }

export interface JobState<T> {
  job: Job | null
  running: boolean
  error: string | null
  start: (starter: () => Promise<{ job: Job }>) => Promise<void>
  result: T | null
}

/** Follows the job registered under `key`. `onDone` fires once when it finishes. */
export function useJob<T = unknown>(key: string, onDone?: (result: T) => void): JobState<T> {
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<T | null>(null)
  const [tick, setTick] = useState(0)
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    const id = running.get(key)
    if (!id) { setJob(null); return }
    let stop = false
    let timer = 0
    let unreachableSince = 0
    const poll = async () => {
      try {
        const j = await get<Job>(`/api/jobs/${id}`)
        if (stop) return
        unreachableSince = 0
        setJob(j)
        if (j.status === 'running') timer = window.setTimeout(poll, 800)
        else {
          running.delete(key)
          if (j.status === 'done') {
            setResult(j.result as T)
            done.current?.(j.result as T)
          } else setError(j.error ?? 'Something went wrong')
        }
      } catch (e) {
        if (stop) return
        const status = e instanceof ApiError ? e.status : 0
        // A busy or restarting server misses a few polls; keep following the job for a few minutes.
        if ((status === 0 || status >= 500) && Date.now() - (unreachableSince ||= Date.now()) < 4 * 60_000) {
          timer = window.setTimeout(poll, 3000)
          return
        }
        running.delete(key)
        setJob(null)
        setError(status === 404 ? 'The server restarted and this job was lost. Start it again.' : errorText(e))
      }
    }
    void poll()
    return () => { stop = true; window.clearTimeout(timer) }
  }, [key, tick])

  const start = useCallback(async (starter: () => Promise<{ job: Job }>) => {
    setError(null)
    setResult(null)
    try {
      const r = await starter()
      running.set(key, r.job.id)
      setJob(r.job)
      setTick((t) => t + 1)
    } catch (e) {
      setError(errorText(e))
    }
  }, [key])

  return { job, running: !!job && job.status === 'running', error, start, result }
}
