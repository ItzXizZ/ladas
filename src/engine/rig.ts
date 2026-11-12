// The shared skeleton. Every style draws on these joints, so a pose means the same thing in
// every style. Local space: feet at y = 0, up is negative y, x = 0 is the body centre line.
import type { CharacterRecord, Expression, Pose } from '../../shared/types.ts'
import type { CharLook } from './style.tsx'
import { lerp, rad } from './math.ts'

export interface Pt { x: number; y: number }

export interface PoseState {
  pose: Pose
  /** Pose being blended from, with blend progress 0..1. */
  from?: Pose
  blend?: number
  /** -1 looks left, 1 looks right, 0 looks at the camera. */
  facing: -1 | 0 | 1
  /** Walk cycle phase (in cycles), or null when standing. */
  walk: number | null
  /** 0..1 squash on impact. */
  squash: number
  /** Head tilt in degrees. */
  tilt: number
  /** Vertical breathing/bounce offset in px (negative is up). */
  bob: number
  /** Frame-driven oscillation for waving and nervous fidgets, in radians. */
  osc: number
}

export interface FaceState {
  expression: Expression
  /** 0..1 mouth openness from the voice envelope. */
  mouth: number
  /** 0..1, 1 is fully closed. */
  blink: number
  sweat: boolean
  /** Drives sweat-drop animation. */
  t: number
}

export interface Rig {
  hip: Pt
  neck: Pt
  head: Pt
  headR: number
  shoulder: [Pt, Pt]
  elbow: [Pt, Pt]
  hand: [Pt, Pt]
  /** Arms drawn behind the torso (hidden-behind-back pose). */
  behind: [boolean, boolean]
  hipJoint: [Pt, Pt]
  foot: [Pt, Pt]
  /** Index of the arm on the side the character faces: the one that points, waves and holds. */
  active: 0 | 1
  shoulderW: number
  hipW: number
  /** Direction of the active forearm in degrees, for orienting held items. */
  handAngle: number
}

type Arm = [number, number, boolean?]
// [upper-arm angle from straight down (positive = away from the body), elbow bend, drawn behind]
const ARMS: Record<Pose, { active: Arm; other: Arm }> = {
  stand: { active: [9, 8], other: [9, 8] },
  point: { active: [96, 2], other: [12, 10] },
  // Heads are wider than shoulders, so raised arms go out past the head before they go up.
  raise: { active: [124, 36], other: [12, 10] },
  hold: { active: [16, -118], other: [16, -118] },
  behind: { active: [-10, -28, true], other: [-10, -28, true] },
  cheer: { active: [128, 34], other: [128, 34] },
  hips: { active: [36, -74], other: [36, -74] },
  think: { active: [30, -178], other: [14, -96] },
  shrug: { active: [46, 66], other: [46, 66] },
  wave: { active: [120, 34], other: [12, 10] },
}

const BUILD = { slim: 0.86, average: 1, broad: 1.16 } as const

export function computeRig(rec: CharacterRecord, look: CharLook, p: PoseState): Rig {
  const build = BUILD[rec.body.build]
  const shoulderW = look.shoulderW * (look.torso === 'tunic' ? 1 : build)
  const hipW = look.hipW * (look.torso === 'tunic' ? 1 : lerp(1, build, 0.7))
  const legH = look.legH
  const torsoH = look.torsoH
  const headR = look.headR

  const walkSwing = p.walk === null ? 0 : Math.sin(p.walk * Math.PI * 2)
  const bob = p.bob + (p.walk === null ? 0 : -Math.abs(Math.cos(p.walk * Math.PI * 2)) * 9)
  const hipY = -legH + bob
  const neckY = hipY - torsoH
  const lean = p.walk === null ? 0 : 6 * p.facing

  const hip: Pt = { x: 0, y: hipY }
  const neck: Pt = { x: lean, y: neckY }
  const tilt = rad(p.tilt)
  const headDist = headR * 0.9 + (look.torso === 'tunic' ? 4 : 2)
  const head: Pt = { x: neck.x + Math.sin(tilt) * headDist, y: neck.y - Math.cos(tilt) * headDist }

  const active: 0 | 1 = p.facing < 0 ? 0 : 1
  const blend = p.from && p.blend !== undefined ? p.blend : 1
  const armFor = (i: 0 | 1): Arm => {
    const to = ARMS[p.pose][i === active ? 'active' : 'other']
    if (blend >= 1 || !p.from) return to
    const fr = ARMS[p.from][i === active ? 'active' : 'other']
    return [lerp(fr[0], to[0], blend), lerp(fr[1], to[1], blend), blend > 0.5 ? to[2] : fr[2]]
  }

  const ua = torsoH * 0.47
  const fa = torsoH * 0.45
  const shoulderDrop = look.torso === 'tunic' ? 22 : 20
  const shrugLift = p.pose === 'shrug' ? -10 * blend : 0
  const shoulder: [Pt, Pt] = [
    { x: neck.x - shoulderW / 2, y: neckY + shoulderDrop + shrugLift },
    { x: neck.x + shoulderW / 2, y: neckY + shoulderDrop + shrugLift },
  ]
  const elbow = [] as unknown as [Pt, Pt]
  const hand = [] as unknown as [Pt, Pt]
  const behind: [boolean, boolean] = [false, false]
  let handAngle = 0
  for (const i of [0, 1] as const) {
    const side = i === 0 ? -1 : 1
    let [a1, a2, bh] = armFor(i)
    // Arms swing opposite to legs when walking; waving and fidgeting ride on the oscillator.
    if (p.walk !== null && p.pose === 'stand') a1 += walkSwing * 22 * side * (p.facing || 1) * -1
    if (p.pose === 'wave' && i === active) a2 += Math.sin(p.osc * 2.2) * 26
    if (p.pose === 'cheer') a1 += Math.sin(p.osc * 2 + i) * 7
    const t1 = rad(a1)
    const t2 = rad(a1 + a2)
    elbow[i] = { x: shoulder[i].x + side * Math.sin(t1) * ua, y: shoulder[i].y + Math.cos(t1) * ua }
    hand[i] = { x: elbow[i].x + side * Math.sin(t2) * fa, y: elbow[i].y + Math.cos(t2) * fa }
    behind[i] = !!bh
    if (i === active) handAngle = a1 + a2
  }

  const hj = hipW * 0.27
  const hipJoint: [Pt, Pt] = [{ x: -hj, y: hipY }, { x: hj, y: hipY }]
  const dir = p.facing || 1
  const legAngle = [rad(walkSwing * 26 * dir), rad(-walkSwing * 26 * dir)]
  const foot: [Pt, Pt] = [
    { x: hipJoint[0].x + Math.sin(legAngle[0]) * legH, y: Math.min(0, hipY + Math.cos(legAngle[0]) * legH) },
    { x: hipJoint[1].x + Math.sin(legAngle[1]) * legH, y: Math.min(0, hipY + Math.cos(legAngle[1]) * legH) },
  ]
  if (p.walk !== null) {
    // The trailing foot lifts off the ground.
    const lift = Math.max(0, Math.cos(p.walk * Math.PI * 2)) * 16
    const lift2 = Math.max(0, -Math.cos(p.walk * Math.PI * 2)) * 16
    foot[0].y -= lift
    foot[1].y -= lift2
  }

  return { hip, neck, head, headR, shoulder, elbow, hand, behind, hipJoint, foot, active, shoulderW, hipW, handAngle }
}

/** Approximate height of a standing character in local units, including hair. */
export const charHeight = (look: CharLook) => look.legH + look.torsoH + look.headR * 2.05

// ---------- Face parameters shared by every style ----------
export interface FaceParams {
  browLift: number
  /** Positive tilts the inner brow down (stern); negative lifts it (worried). */
  browTilt: number
  /** Raises only the far brow (smug). */
  browAsym: number
  eyeOpen: number
  pupil: number
  /** closed mouths: curve >0 smiles, <0 frowns */
  curve: number
  mouth: 'line' | 'grin' | 'o' | 'smirk' | 'wavy'
  arcEyes: boolean
}

export const FACE: Record<Expression, FaceParams> = {
  neutral: { browLift: 0, browTilt: 0, browAsym: 0, eyeOpen: 1, pupil: 1, curve: 0.1, mouth: 'line', arcEyes: false },
  happy: { browLift: 0.05, browTilt: -0.05, browAsym: 0, eyeOpen: 1, pupil: 1, curve: 0.3, mouth: 'line', arcEyes: false },
  grin: { browLift: 0.1, browTilt: -0.05, browAsym: 0, eyeOpen: 0.9, pupil: 1, curve: 0.3, mouth: 'grin', arcEyes: false },
  shock: { browLift: 0.26, browTilt: -0.1, browAsym: 0, eyeOpen: 1.28, pupil: 0.62, curve: 0, mouth: 'o', arcEyes: false },
  worried: { browLift: 0.12, browTilt: -0.42, browAsym: 0, eyeOpen: 1.08, pupil: 0.8, curve: -0.12, mouth: 'wavy', arcEyes: false },
  sad: { browLift: 0.02, browTilt: -0.5, browAsym: 0, eyeOpen: 0.8, pupil: 1, curve: -0.3, mouth: 'line', arcEyes: false },
  smug: { browLift: 0, browTilt: 0.22, browAsym: 0.2, eyeOpen: 0.55, pupil: 1, curve: 0.2, mouth: 'smirk', arcEyes: false },
  proud: { browLift: 0.12, browTilt: -0.08, browAsym: 0, eyeOpen: 1, pupil: 1, curve: 0.38, mouth: 'line', arcEyes: true },
}
