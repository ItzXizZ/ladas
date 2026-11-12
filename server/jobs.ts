// Long-running pipeline stages run as jobs the UI polls for progress.
import type { Job } from '../shared/types.ts'
import { newId } from '../shared/starter.ts'
import { scheduleFileSync } from './cloud.ts'

const jobs = new Map<string, Job>()

export interface JobHandle {
  /** Report progress 0..1 with a human-readable status line. */
  step(progress: number, message: string): void
  log(message: string): void
}

interface JobOptions {
  /** Heavy jobs (browser, ffmpeg, voice model) run one at a time: two at once run the host out of memory. */
  heavy?: boolean
  /** While a job with this key is running, starting another returns it instead of a duplicate. */
  key?: string
}

let heavyQueue: Promise<unknown> = Promise.resolve()
let heavyWaiting = 0
const running = new Map<string, Job>()

export function startJob<T>(kind: string, run: (h: JobHandle) => Promise<T>, opts: JobOptions = {}): Job {
  const same = opts.key ? running.get(opts.key) : undefined
  if (same) return same
  const job: Job = { id: newId('job'), kind, status: 'running', progress: 0, message: 'Starting', log: [] }
  jobs.set(job.id, job)
  if (opts.key) running.set(opts.key, job)
  const handle: JobHandle = {
    step(progress, message) {
      job.progress = Math.max(0, Math.min(1, progress))
      job.message = message
      job.log.push(message)
      console.log(`[${kind}] ${message}`)
    },
    log(message) {
      job.log.push(message)
      console.log(`[${kind}] ${message}`)
    },
  }
  let work: Promise<T>
  if (opts.heavy) {
    const ahead = heavyWaiting++
    if (ahead) job.message = ahead === 1 ? 'Waiting for the job ahead to finish' : `Waiting for ${ahead} jobs ahead to finish`
    work = heavyQueue.then(() => { heavyWaiting--; return run(handle) })
    heavyQueue = work.catch(() => undefined)
  } else {
    work = run(handle)
  }
  work
    .finally(() => {
      if (opts.key && running.get(opts.key) === job) running.delete(opts.key)
      scheduleFileSync()
    })
    .then((result) => {
      job.status = 'done'
      job.progress = 1
      job.result = result
      job.message = 'Done'
    })
    .catch((e: unknown) => {
      job.status = 'failed'
      job.error = e instanceof Error ? e.message : String(e)
      job.message = job.error
      console.error(`[${kind}] failed:`, e)
    })
  // Finished jobs are kept for an hour so a reloaded page can still read the result.
  setTimeout(() => jobs.delete(job.id), 60 * 60 * 1000).unref()
  return job
}

export const getJob = (id: string) => jobs.get(id)
