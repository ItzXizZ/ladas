import '@fontsource/bricolage-grotesque/400.css'
import '@fontsource/bricolage-grotesque/500.css'
import '@fontsource/bricolage-grotesque/700.css'
import '@fontsource/bricolage-grotesque/800.css'
import '../styles.css'
import { createRoot } from 'react-dom/client'
import { loadFonts } from '../engine/fonts.ts'
import { App } from './App.tsx'
import { Gate } from './Gate.tsx'

export async function mountStudio(el: HTMLElement) {
  // The engine measures text to lay scenes out, so its fonts must be ready before anything draws.
  await loadFonts().catch(() => undefined)
  createRoot(el).render(<Gate><App /></Gate>)
}
