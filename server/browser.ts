// One place that knows how to start a browser. Uses the Chrome or Edge already on the machine,
// so there is nothing to download.
import { chromium, type Browser } from 'playwright-core'
import { env } from './env.ts'

let working: string | null | undefined

export async function launchBrowser(): Promise<Browser> {
  // A container ships its own Chromium; CHROME_PATH points at it. There is no sandbox support inside a container.
  if (env.chromePath) {
    const browser = await chromium.launch({ executablePath: env.chromePath, headless: true, args: ['--force-color-profile=srgb', '--hide-scrollbars', '--no-sandbox', '--disable-dev-shm-usage'] })
    working = 'chromium'
    return browser
  }
  const channels = [env.browserChannel, working ?? '', 'chrome', 'msedge', 'chromium'].filter((c, i, a) => c && a.indexOf(c) === i)
  let last: unknown
  for (const channel of channels) {
    try {
      const browser = await chromium.launch({ channel: channel === 'chromium' ? undefined : channel, headless: true, args: ['--force-color-profile=srgb', '--hide-scrollbars'] })
      working = channel
      return browser
    } catch (e) {
      last = e
    }
  }
  throw new Error(`No usable browser found (tried ${channels.join(', ')}). Install Chrome or set BROWSER_CHANNEL in .env. ${String(last).split('\n')[0]}`)
}

export async function browserName(): Promise<string | null> {
  if (working) return working
  try {
    const b = await launchBrowser()
    await b.close()
    return working ?? null
  } catch {
    return null
  }
}

/** tsx compiles with esbuild's keepNames, which wraps functions in __name(). Pages need a no-op for it. */
export const NAME_SHIM = 'globalThis.__name = globalThis.__name || ((fn) => fn);'
