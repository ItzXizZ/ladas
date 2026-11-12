// Long-running pipeline stages run as jobs the UI polls for progress.
import type { Job } from '../shared/types.ts'
import { newId } from '../shared/starter.ts'

const jobs = new Map<string, Job>()

export interface JobHandle {
  /** Report progress 0..1 with a human-readable status line. */
  step(progress: number, message: string): void
  log(message: string): void
}

export function startJob<T>(kind: string, run: (h: JobHandle) => Promise<T>): Job {
  const job: Job = { id: newId('job'), kind, status: 'running', progress: 0, message: 'Starting', log: [] }
  jobs.set(job.id, job)
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
  run(handle)
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
