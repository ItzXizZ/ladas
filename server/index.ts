// Ladas as a long-running process: the API from app.ts plus the front end, on one port.
// `npm run dev` serves the front end through Vite, `npm start` serves the built dist/ folder.
import express from 'express'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import app from './app.ts'
import { authRequired } from './auth.ts'
import { cloudInfo, restoreFiles, startCloud } from './cloud.ts'
import { env, ffmpegPath, ROOT } from './env.ts'
import { llmReady } from './llm.ts'

// Leave a trace in the host's logs when the process dies or runs short of memory.
process.on('uncaughtException', (e) => { console.error('[fatal] uncaught exception:', e) })
process.on('unhandledRejection', (e) => { console.error('[fatal] unhandled rejection:', e) })
setInterval(() => {
  const rss = Math.round(process.memoryUsage().rss / 1048576)
  if (rss > 700) console.log(`[mem] rss ${rss} MB`)
}, 10_000).unref()

// With Supabase configured, bring the saved footage, audio and renders back onto this disk first.
await restoreFiles()
startCloud()

const server = createServer(app)
if (env.prod && existsSync(join(ROOT, 'dist', 'index.html'))) {
  app.use(express.static(join(ROOT, 'dist')))
  app.get(/.*/, (_req, res) => { res.sendFile(join(ROOT, 'dist', 'index.html')) })
} else {
  const { createServer: createVite } = await import('vite')
  const vite = await createVite({ root: ROOT, appType: 'spa', server: { middlewareMode: true, ws: { server } } })
  app.use(vite.middlewares)
}

// The API can spend the keys in .env, so it stays on this machine unless HOST says otherwise
// (a container host sets HOST=0.0.0.0 and SITE_PASSWORD).
server.listen(env.port, env.host, () => {
  console.log(`\n  Ladas is running at http://localhost:${env.port}   (listening on ${env.host})\n`)
  console.log(`  Claude: ${llmReady() ? 'key set' : 'no key (template stories and scripts)'}   ElevenLabs: ${env.elevenKey ? 'key set' : 'no key (free voices only)'}   ffmpeg: ${ffmpegPath() ? 'ready' : 'missing, run `npm run setup`'}`)
  console.log(`  Password gate: ${authRequired ? 'on' : 'off (set SITE_PASSWORD to turn it on)'}   Supabase: ${cloudInfo() ? 'on' : 'off (data stays on this disk)'}\n`)
})
server.on('error', (e: NodeJS.ErrnoException) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${env.port} is already in use. Set PORT in .env or stop the other process.` : e)
  process.exit(1)
})
