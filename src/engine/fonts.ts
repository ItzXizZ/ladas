// Fonts are bundled locally so renders never depend on the network.
import '@fontsource/lilita-one/400.css'
import '@fontsource/baloo-2/700.css'
import '@fontsource/gochi-hand/400.css'
import '@fontsource/patrick-hand/400.css'
import '@fontsource/dm-serif-display/400.css'
import '@fontsource/archivo-black/400.css'
import '@fontsource/space-grotesk/700.css'
import { resetMeasure } from './style.tsx'

const FACES = [
  '400 40px "Lilita One"', '700 40px "Baloo 2"', '400 40px "Gochi Hand"', '400 40px "Patrick Hand"',
  '400 40px "DM Serif Display"', '400 40px "Archivo Black"', '700 40px "Space Grotesk"',
]

let ready: Promise<void> | null = null
/** Resolves once every engine font is usable. Layout measures text, so nothing may draw before this. */
export function loadFonts(): Promise<void> {
  ready ??= Promise.all(FACES.map((f) => document.fonts.load(f, 'Ladas 0123')))
    .then(() => document.fonts.ready)
    .then(() => resetMeasure())
  return ready
}
