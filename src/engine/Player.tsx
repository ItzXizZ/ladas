// Live preview. Draws the same frames the renderer exports; when a voice exists the audio is the
// clock, so picture and sound cannot drift.
import { useCallback, useEffect, useRef, useState } from 'react'
import { FPS, type ReelBundle } from '../../shared/types.ts'
import { ReelFrame, usePrepared } from './ReelFrame.tsx'

export interface PlayerProps {
  bundle: ReelBundle
  autoPlay?: boolean
  loop?: boolean
  controls?: boolean
  muted?: boolean
  /** Redraw rate for small looping previews. Defaults to the full 30. */
  fps?: number
  /** Jump to a frame: change `n` to seek again to the same frame. */
  seek?: { frame: number; n: number } | null
  onScene?: (index: number) => void
  className?: string
}

const clock = (frames: number) => {
  const s = Math.max(0, frames / FPS)
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

export function Player({ bundle, autoPlay, loop, controls = true, muted, fps, seek, onScene, className }: PlayerProps) {
  const prepared = usePrepared(bundle)
  const total = prepared.timeline.totalFrames
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(!!autoPlay)
  const pos = useRef(0)
  const audioRef = useRef<HTMLAudioElement>(null)
  const voice = bundle.reel.voice
  const src = !muted && prepared.voiced ? voice?.mixUrl ?? voice?.voiceUrl : undefined
  const sceneCb = useRef(onScene)
  sceneCb.current = onScene

  const jump = useCallback((f: number) => {
    const to = Math.max(0, Math.min(total - 1, f))
    pos.current = to
    setFrame(Math.floor(to))
    if (audioRef.current && src) audioRef.current.currentTime = to / FPS
  }, [total, src])

  // A shorter script must not leave the playhead past the end.
  useEffect(() => { if (pos.current > total - 1) jump(0) }, [total, jump])
  useEffect(() => { if (seek) jump(seek.frame) }, [seek, jump])

  useEffect(() => {
    const audio = audioRef.current
    if (!playing) { audio?.pause(); return }
    let raf = 0
    let last = performance.now()
    let shown = -1
    let useAudio = !!(audio && src)
    if (pos.current >= total - 1) pos.current = 0
    if (audio && useAudio) {
      audio.currentTime = pos.current / FPS
      audio.play().catch(() => { useAudio = false })
    }
    const every = fps ? FPS / fps : 1
    const step = (now: number) => {
      let f: number
      if (audio && useAudio && !audio.ended) f = audio.currentTime * FPS
      else f = pos.current + ((now - last) / 1000) * FPS
      last = now
      if (f >= total - 1) {
        if (loop) {
          f = 0
          if (audio && useAudio) { audio.currentTime = 0; void audio.play().catch(() => { useAudio = false }) }
        } else {
          pos.current = total - 1
          setFrame(total - 1)
          setPlaying(false)
          return
        }
      }
      pos.current = f
      const q = Math.floor(f / every) * every
      if (q !== shown) { shown = q; setFrame(q) }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => { cancelAnimationFrame(raf); audio?.pause() }
  }, [playing, src, total, loop, fps])

  const sceneIndex = (() => {
    const sc = prepared.timeline.scenes
    for (let i = sc.length - 1; i >= 0; i--) if (frame >= sc[i].start) return i
    return 0
  })()
  useEffect(() => { sceneCb.current?.(sceneIndex) }, [sceneIndex])

  return (
    <div className={`player ${className ?? ''}`}>
      <div className="player-frame" onClick={controls ? () => setPlaying((p) => !p) : undefined}>
        <ReelFrame bundle={bundle} prepared={prepared} frame={frame} />
        {controls && !playing && <div className="player-badge" aria-hidden>▶</div>}
      </div>
      {src && <audio ref={audioRef} src={src} preload="auto" />}
      {controls && (
        <div className="player-bar">
          <button className="icon-btn" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
          <div className="scrub">
            <input type="range" min={0} max={Math.max(1, total - 1)} value={frame} onChange={(e) => { setPlaying(false); jump(Number(e.target.value)) }} aria-label="Position" />
            <div className="scrub-marks" aria-hidden>
              {prepared.timeline.scenes.slice(1).map((s) => <i key={s.id} style={{ left: `${(s.start / Math.max(1, total - 1)) * 100}%` }} />)}
            </div>
          </div>
          <span className="time">{clock(frame)} / {clock(total)}</span>
        </div>
      )}
    </div>
  )
}
