// One frame of a reel as SVG. The same component draws the live preview, thumbnails and the
// frames the renderer screenshots, so what you preview is what gets exported.
import { useId, useMemo } from 'react'
import { FPS, H, W, type CharacterRecord, type ReelBundle } from '../../shared/types.ts'
import { compileTimeline, sceneAt, scriptHash, type Timeline } from '../../shared/timeline.ts'
import { Captions } from './Props.tsx'
import { CtaScene, ProductScene } from './Product.tsx'
import { StoryScene, TransitionOverlay } from './Scene.tsx'
import { PaintProvider, STYLES } from './style.tsx'
import { rr } from './math.ts'

export interface Prepared {
  timeline: Timeline
  envelope: number[]
  characters: Map<string, CharacterRecord>
  voiced: boolean
}

/** Resolve timing and lip-sync data once per reel version. */
export function prepare(bundle: ReelBundle): Prepared {
  const { reel } = bundle
  const timeline = compileTimeline(reel)
  const voiced = !!reel.voice && reel.voice.scriptHash === scriptHash(reel.scenes) && reel.voice.words.length > 0
  let envelope: number[]
  if (voiced) envelope = reel.voice!.envelope
  else {
    // No audio yet: mouths still move with the estimated word timings.
    envelope = new Array(timeline.totalFrames).fill(0)
    for (const w of timeline.words) {
      const a = Math.round(w.start * FPS)
      const b = Math.round(w.end * FPS)
      for (let f = a; f < b && f < envelope.length; f++) envelope[f] = 0.35 + 0.5 * Math.abs(Math.sin((f - a) * 0.9 + a))
    }
  }
  return { timeline, envelope, characters: new Map(bundle.characters.map((c) => [c.id, c])), voiced }
}

export const usePrepared = (bundle: ReelBundle) => useMemo(() => prepare(bundle), [bundle])

let grainUrl: string | null = null
function grain(): string {
  if (grainUrl) return grainUrl
  const size = 256
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d')!
  const img = ctx.createImageData(size, size)
  let s = 1234567
  for (let i = 0; i < size * size; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    const v = 150 + ((s >>> 16) % 106)
    img.data[i * 4] = v
    img.data[i * 4 + 1] = v - 6
    img.data[i * 4 + 2] = v - 18
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  grainUrl = cv.toDataURL('image/png')
  return grainUrl
}

export interface ReelFrameProps {
  bundle: ReelBundle
  prepared: Prepared
  frame: number
  /** Hide captions (the exported SRT still carries them). */
  captions?: boolean
  className?: string
}

export function ReelFrame({ bundle, prepared, frame, captions = true, className }: ReelFrameProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const { reel, product } = bundle
  const style = STYLES[reel.style] ?? STYLES.cartoon
  const { timeline } = prepared
  const f = Math.max(0, Math.min(timeline.totalFrames - 1, Math.round(frame)))
  const time = sceneAt(timeline, f)
  const scene = reel.scenes[time.index]
  const paint = useMemo(() => ({ style, brand: { primary: product.brand.primary, accent: product.brand.accent }, uid }), [style, product.brand.primary, product.brand.accent, uid])
  const chunk = captions && reel.settings.captions ? timeline.captions.find((c) => f >= c.start && f < c.end) : undefined
  if (!scene) return <svg viewBox={`0 0 ${W} ${H}`} className={className} />

  const ctx = { scene, time, f, index: time.index, characters: prepared.characters, envelope: prepared.envelope, reelId: reel.id }
  const prev = reel.scenes[time.index - 1]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', background: style.paper }}>
      <PaintProvider value={paint}>
        <defs>
          <clipPath id={`${uid}-frame`}>
            <path d={rr(0, 0, W, H)} />
          </clipPath>
          {style.grain > 0 && (
            <pattern id={`${uid}-grain`} width={256} height={256} patternUnits="userSpaceOnUse">
              <image href={grain()} width={256} height={256} />
            </pattern>
          )}
        </defs>
        <g clipPath={`url(#${uid}-frame)`} data-scene-id={scene.id} data-frame={f}>
          {scene.kind === 'product' ? (
            <ProductScene {...ctx} product={product} prevWasProduct={prev?.kind === 'product'} />
          ) : scene.kind === 'cta' ? (
            <CtaScene {...ctx} product={product} />
          ) : (
            <StoryScene {...ctx} />
          )}
          <TransitionOverlay scene={scene} time={time} f={f} index={time.index} />
          {style.grain > 0 && <rect x={0} y={0} width={W} height={H} fill={`url(#${uid}-grain)`} opacity={style.grain} style={{ mixBlendMode: 'multiply' }} />}
          <Captions chunk={chunk} f={f} />
        </g>
      </PaintProvider>
    </svg>
  )
}
