// The scene compiler's drawing half: a style-neutral SceneSpec in, a frame out. Layout is done
// here by rule (slots, bands, clamps), so the writer never places anything by pixel.
import { H, W, type ActorSpec, type CharacterRecord, type Expression, type Pose, type SceneSpec } from '../../shared/types.ts'
import { eventFrame, STAMP_IMPACT, type SceneTime } from '../../shared/timeline.ts'
import { hashString, randomCharacter } from '../../shared/starter.ts'
import { Character } from './Character.tsx'
import { clamp, easeIn, easeInOut, easeOut, easeOutBack, lerp, n1, prog, rnd, wobble } from './math.ts'
import { Bubble, Burst, PropView, slotBox } from './Props.tsx'
import { charHeight, computeRig, type FaceState, type PoseState } from './rig.ts'
import { GROUND, SetView } from './Sets.tsx'
import { usePaint, type StyleDef } from './style.tsx'

/** Characters are normalised to this standing height in world px, whatever the style's proportions. */
export const CHAR_WORLD_H = 700
export const charScale = (style: StyleDef) => CHAR_WORLD_H / charHeight(style.char)

export interface SceneCtx {
  scene: SceneSpec
  time: SceneTime
  /** Absolute frame. */
  f: number
  index: number
  characters: Map<string, CharacterRecord>
  /** Voice loudness per frame, 0..1. */
  envelope: number[]
  reelId: string
}

const SLOT_X = { left: 270, center: 540, right: 810 } as const
/** Half the width a head needs on screen, in world px, hair included. */
const HEAD_HALF = 165
/** Three actors share the frame at a slightly smaller size so their heads do not collide. */
const TRIO_SCALE = 0.9

export function actorX(scene: SceneSpec, a: ActorSpec): number {
  const slots = new Set(scene.actors.map((x) => x.slot))
  if (scene.actors.length === 2 && slots.has('left') && slots.has('right')) return a.slot === 'left' ? 305 : 775
  return SLOT_X[a.slot]
}

export interface ActorFrame {
  x: number
  y: number
  scale: number
  opacity: number
  pose: PoseState
  face: FaceState
  /** Head centre and radius in world coordinates. */
  head: { x: number; y: number; r: number }
}

/** Everything about an actor at frame f: where it stands, its pose, face, and where its head is. */
export function actorFrame(a: ActorSpec, rec: CharacterRecord, c: Pick<SceneCtx, 'scene' | 'time' | 'f' | 'envelope'>, style: StyleDef, opts?: { x?: number; ground?: number; scale?: number }): ActorFrame {
  const { scene, time } = c
  const local = c.f - time.start
  const lf = style.step > 1 ? Math.floor(local / style.step) * style.step : local
  const seed = hashString(rec.id) % 1000
  const cs = (opts?.scale ?? (scene.actors.length >= 3 ? TRIO_SCALE : 1)) * charScale(style)
  const homeX = opts?.x ?? actorX(scene, a)
  const ground = opts?.ground ?? GROUND
  const multi = scene.actors.length > 1
  const facing: -1 | 0 | 1 = !multi && a.slot === 'center' ? 0 : a.slot === 'left' ? 1 : a.slot === 'right' ? -1 : 0

  let x = homeX
  let yOff = 0
  let scale = cs
  let opacity = 1
  let walk: number | null = null
  let squash = 0
  let face: -1 | 0 | 1 = facing

  if (a.enter === 'walk') {
    const len = Math.min(24, Math.max(10, Math.round(time.duration * 0.45)))
    const p = prog(lf, 0, len)
    const from = a.slot === 'right' ? W + 220 : -220
    x = lerp(from, homeX, easeOut(p))
    if (p < 1) {
      walk = lf / (rec.performance.walk === 'bouncy' ? 9 : rec.performance.walk === 'slouch' ? 13 : 11)
      face = a.slot === 'right' ? -1 : 1
    }
  } else if (a.enter === 'pop') {
    const p = prog(lf, 2, 8)
    scale = cs * Math.max(0, easeOutBack(p, 2))
    opacity = lf < 2 ? 0 : 1
  } else if (a.enter === 'drop') {
    const p = prog(lf, 0, 9)
    yOff = lerp(-1500, 0, easeIn(p))
    squash = p >= 1 ? Math.max(0, wobble(prog(lf, 9, 14), 1.5)) * 1.6 + (lf < 12 ? 0.5 : 0) : 0
  }

  // Mid-scene reaction: pose blends, expression snaps, a small startled hop.
  const reactAt = a.react ? eventFrame(time, a.react.at, 0.5) - time.start : Infinity
  const reacted = lf >= reactAt
  const expression: Expression = reacted && a.react ? a.react.expression : a.expression
  const pose: Pose = reacted && a.react?.pose ? a.react.pose : a.pose
  const blend = reacted && a.react?.pose ? prog(lf, reactAt, 6) : 1
  const hop = reacted ? Math.sin(prog(lf, reactAt, 9) * Math.PI) * -22 : 0
  // Stretch tall for a beat as the reaction hits.
  if (reacted && lf - reactAt < 4 && squash === 0) squash = -0.25

  const energy = rec.performance.energy
  const breathe = Math.sin(lf * 0.11 + seed) * (energy === 'hype' ? 5 : 3)
  const jitter = energy === 'nervous' || expression === 'worried' ? Math.sin(lf * 0.9 + seed) * 1.6 : 0
  const cheerBounce = pose === 'cheer' ? -Math.abs(Math.sin(lf * 0.3 + seed)) * 22 : 0
  const tilt = Math.sin(lf * 0.06 + seed * 1.7) * 2.2 + (expression === 'shock' ? -5 * (face || 1) : expression === 'smug' ? 5 * (face || 1) : expression === 'sad' ? 6 : 0)

  // Lip-sync: narration loudness for the speaker, a short babble when a bubble pops.
  const env = c.envelope[c.f] ?? 0
  const bubbleAt = a.bubble ? eventFrame(time, a.bubbleAt, 0.2) - time.start : Infinity
  const babble = local >= bubbleAt && local < bubbleAt + 16 ? Math.abs(Math.sin((local - bubbleAt) * 0.9)) * 0.75 : 0
  const mouth = a.speaks ? Math.max(env, babble) : babble

  const blinkCycle = 84 + (seed % 40)
  const blinkPos = (c.f + seed * 7) % blinkCycle
  const blink = blinkPos < 3 ? 1 : 0

  const poseState: PoseState = { pose, from: reacted && a.react?.pose ? a.pose : undefined, blend, facing: face, walk, squash, tilt, bob: breathe + jitter + hop + cheerBounce, osc: lf * 0.13 + seed }
  const faceState: FaceState = { expression, mouth: clamp(mouth), blink, sweat: expression === 'worried' || (expression === 'shock' && energy === 'nervous'), t: lf }

  const rig = computeRig(rec, style.char, poseState)
  const k = scale * rec.body.height
  return {
    x, y: ground + yOff, scale, opacity, pose: poseState, face: faceState,
    head: { x: x + rig.head.x * k, y: ground + yOff + rig.head.y * k, r: rig.headR * k },
  }
}

export interface Cam { s: number; tx: number; ty: number }
export const camPoint = (cam: Cam, x: number, y: number) => ({ x: x * cam.s + cam.tx, y: y * cam.s + cam.ty })

/** Frames at which something hits: stamps landing, actors dropping in. The camera shakes on these. */
function impacts(scene: SceneSpec, time: SceneTime): number[] {
  const out: number[] = []
  for (const p of scene.props) if (p.kind === 'stamp') out.push(eventFrame(time, p.at) + STAMP_IMPACT)
  if (scene.actors.some((a) => a.enter === 'drop')) out.push(time.start + 9)
  if (scene.camera === 'shake' && !out.length) out.push(time.start + Math.round(time.duration * 0.3))
  return out
}

/** World-to-screen transform for a story scene: shot framing, then the camera move on top. */
export function sceneCamera(c: Pick<SceneCtx, 'scene' | 'time' | 'f'>, style: StyleDef): Cam {
  const { scene, time, f } = c
  const local = f - time.start
  const p = easeInOut(prog(local, 0, time.duration))
  const xs = scene.actors.map((a) => actorX(scene, a))
  const speaker = Math.max(0, scene.actors.findIndex((a) => a.speaks || a.bubble))
  const mean = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : W / 2
  let s = 1
  let fx = W / 2
  let tyAnchor: [number, number] = [GROUND, GROUND]
  if (scene.shot === 'medium') {
    s = scene.actors.length > 2 ? 1.12 : 1.3
    fx = mean
    tyAnchor = [GROUND, 1530]
  } else if (scene.shot === 'close') {
    // Frame the head just under the top band, whatever the style's proportions.
    const L = style.char
    const headUp = (L.legH + L.torsoH + L.headR * 0.9) / charHeight(L)
    s = L.headR < 80 ? 1.95 : 1.7
    fx = xs[speaker] ?? W / 2
    tyAnchor = [GROUND - CHAR_WORLD_H * headUp, 560 + 60 + L.headR * charScale(style) * s * 1.12]
  }
  if (scene.camera === 'rack' && xs.length > 1) {
    s *= scene.shot === 'wide' ? 1.25 : 1.08
    fx = lerp(xs[0], xs[xs.length - 1], easeInOut(prog(local, time.duration * 0.3, time.duration * 0.3)))
    if (scene.shot === 'wide') tyAnchor = [GROUND, GROUND + 150]
  }
  let tx = W / 2 - fx * s
  let ty = tyAnchor[1] - tyAnchor[0] * s
  // Never show past the edge of the set.
  tx = clamp(tx, W - 1500 * s, 420 * s)

  const about = (k: number, cx = W / 2, cy = 900) => {
    tx = cx - (cx - tx) * k
    ty = cy - (cy - ty) * k
    s *= k
  }
  if (scene.camera === 'push') about(1 + 0.09 * p)
  if (scene.camera === 'pull') about(1.09 - 0.09 * p)
  if (scene.camera === 'pan-left') { about(1.06); tx += lerp(34, -34, p) }
  if (scene.camera === 'pan-right') { about(1.06); tx += lerp(-34, 34, p) }
  // Whatever the move, every actor's head stays in frame: zoom out and re-centre if it must.
  if (xs.length) {
    const half = HEAD_HALF * (scene.actors.length >= 3 ? TRIO_SCALE : 1)
    const lo = Math.min(...xs) - half
    const hi = Math.max(...xs) + half
    const room = W - 2 * 22
    if ((hi - lo) * s > room) {
      about(room / ((hi - lo) * s), W / 2, GROUND * s + ty)
      tx = W / 2 - ((lo + hi) / 2) * s
    } else tx = clamp(tx, W - 22 - hi * s, 22 - lo * s)
  }
  for (const hit of impacts(scene, time)) {
    const age = f - hit
    if (age >= 0 && age < 12) {
      const amp = 20 * (1 - age / 12)
      if (style.id !== 'paper' || age % 2 === 0) {
        tx += (rnd(f, 1) - 0.5) * 2 * amp
        ty += (rnd(f, 2) - 0.5) * 2 * amp
      }
    }
  }
  return { s, tx, ty }
}

/** Bubble lanes: each speaker's bubble stays in its own horizontal lane so two never collide. */
function bubbleBounds(scene: SceneSpec, a: ActorSpec): [number, number] {
  const talkers = scene.actors.filter((x) => x.bubble)
  if (talkers.length <= 1) return [36, W - 36]
  if (a.slot === 'left') return [36, W / 2 - 8]
  if (a.slot === 'right') return [W / 2 + 8, W - 36]
  return [200, W - 200]
}

export function TransitionOverlay({ scene, time, f, index }: { scene: SceneSpec; time: SceneTime; f: number; index: number }) {
  const { style, brand } = usePaint()
  if (index === 0) return null
  const local = f - time.start
  const p = prog(local, 0, 8)
  if (p >= 1) return null
  switch (scene.transition) {
    case 'flash':
      return <rect x={0} y={0} width={W} height={H} fill="#ffffff" opacity={1 - easeOut(p)} />
    case 'whip':
      return (
        <g opacity={1 - p}>
          {Array.from({ length: 9 }).map((_, i) => (
            <rect key={i} x={-100} y={rnd(i, index) * H} width={W + 200} height={10 + rnd(i, 7) * 26} fill={i % 2 ? '#ffffff' : style.ink} opacity={0.35} />
          ))}
        </g>
      )
    case 'iris': {
      const r = easeOut(p) * 1350
      return <path d={`M -10 -10 L ${W + 10} -10 L ${W + 10} ${H + 10} L -10 ${H + 10} Z M ${n1(W / 2 - r)} 900 a ${n1(r)} ${n1(r)} 0 1 0 ${n1(r * 2)} 0 a ${n1(r)} ${n1(r)} 0 1 0 ${n1(-r * 2)} 0 Z`} fill={style.ink} fillRule="evenodd" />
    }
    case 'match': {
      const r = (1 - easeInOut(p)) * 1400
      return <circle cx={W / 2} cy={900} r={n1(r)} fill={brand.accent} />
    }
    default:
      return null
  }
}

/** Horizontal slide of the incoming scene on a whip pan. */
export const whipOffset = (scene: SceneSpec, time: SceneTime, f: number, index: number) =>
  index > 0 && scene.transition === 'whip' ? (1 - easeOut(prog(f - time.start, 0, 7))) * W * (index % 2 ? 1 : -1) : 0

export function StoryScene(c: SceneCtx) {
  const { style } = usePaint()
  const { scene, time, f } = c
  const cam = sceneCamera(c, style)
  const local = f - time.start
  const lf = style.step > 1 ? Math.floor(local / style.step) * style.step : local

  const order = { left: 0, right: 1, center: 2 } as const
  const actors = scene.actors
    .map((a) => ({ a, rec: c.characters.get(a.characterId) }))
    .filter((x): x is { a: ActorSpec; rec: CharacterRecord } => !!x.rec)
    .sort((p, q) => order[p.a.slot] - order[q.a.slot])
    .map(({ a, rec }) => ({ a, rec, fr: actorFrame(a, rec, c, style) }))

  // Extras stand further back (smaller, feet higher up) in the gaps the cast leaves.
  const palette = [...c.characters.values()].map((r) => r.wardrobe.topColor)
  const taken = actors.map(({ a }) => actorX(scene, a))
  const spots = [70, 1010, 540, 405, 675, 185, 895].filter((x) => taken.every((t) => Math.abs(t - x) >= 118)).slice(0, clamp(scene.crowd, 0, 6))
  const crowd = spots.map((x0, i) => {
    const rec = randomCharacter(`${c.reelId}-${i}`, palette)
    const x = x0 + (rnd(i, 3) - 0.5) * 30
    const spec: ActorSpec = { characterId: rec.id, slot: x < 420 ? 'left' : x > 660 ? 'right' : 'center', pose: 'stand', expression: (['happy', 'neutral', 'grin'] as const)[i % 3], enter: 'none', outfit: 'default', holding: 'none', speaks: false }
    return { rec, fr: actorFrame(spec, rec, { ...c, scene: { ...scene, actors: [spec, spec] } }, style, { x, ground: GROUND - 74 - (i % 2) * 14, scale: 0.68 }) }
  })

  const bursts = scene.props.filter((p) => p.kind === 'burst')
  const overlays = scene.props.filter((p) => p.kind !== 'burst')
  const slide = whipOffset(scene, time, f, c.index)

  return (
    <g transform={slide ? `translate(${n1(slide)} 0)` : undefined}>
      <g transform={`translate(${n1(cam.tx)} ${n1(cam.ty)}) scale(${n1(cam.s * 1000) / 1000})`}>
        <SetView set={scene.set} f={lf} />
        {bursts.map((p, i) => (
          <Burst key={i} t={lf - (eventFrame(time, p.at) - time.start)} cx={actors[0]?.fr.x ?? W / 2} cy={GROUND - CHAR_WORLD_H * 0.55} tone={p.tone} />
        ))}
        {crowd.map(({ rec, fr }, i) => (
          <g key={`crowd${i}`} transform={`translate(${n1(fr.x)} ${n1(fr.y)}) scale(${n1(fr.scale * 100) / 100})`} style={{ filter: 'saturate(0.55) brightness(1.07) contrast(0.86)' }}>
            <Character rec={rec} pose={fr.pose} face={fr.face} />
          </g>
        ))}
        {actors.map(({ a, rec, fr }) => (
          <g key={a.characterId + a.slot} data-qc="actor" data-scene={scene.id} transform={`translate(${n1(fr.x)} ${n1(fr.y)}) scale(${n1(fr.scale * 1000) / 1000})`} opacity={fr.opacity}>
            <Character rec={rec} pose={fr.pose} face={fr.face} outfit={a.outfit} holding={a.holding} />
          </g>
        ))}
      </g>

      {/* Face boxes for QC: nothing may cover a face. */}
      {actors.map(({ a, fr }) => {
        const h = camPoint(cam, fr.head.x, fr.head.y)
        const r = fr.head.r * cam.s * 0.8
        return <rect key={`face-${a.characterId}${a.slot}`} data-qc="face" data-scene={scene.id} x={n1(h.x - r)} y={n1(h.y - r)} width={n1(r * 2)} height={n1(r * 2)} fill="none" />
      })}

      {overlays.map((p, i) => (
        <PropView key={i} prop={p} box={slotBox(p.slot, scene.fix?.propDy ?? 0)} t={lf - (eventFrame(time, p.at) - time.start)} sceneId={scene.id} />
      ))}

      {actors.map(({ a, fr }) => {
        if (!a.bubble) return null
        const h = camPoint(cam, fr.head.x, fr.head.y)
        return (
          <Bubble
            key={`b-${a.characterId}${a.slot}`} text={a.bubble} sceneId={scene.id}
            head={{ x: h.x, y: h.y, r: fr.head.r * cam.s }} bounds={bubbleBounds(scene, a)}
            t={local - (eventFrame(time, a.bubbleAt, 0.2) - time.start)}
            dy={scene.fix?.bubbleDy ?? 0} scale={scene.fix?.bubbleScale ?? 1}
          />
        )
      })}
    </g>
  )
}