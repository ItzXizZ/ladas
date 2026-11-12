// One-off environment probe: does Kokoro TTS and system Chrome automation work on this machine?
import { chromium } from 'playwright-core'
import { writeFileSync, mkdirSync } from 'node:fs'

mkdirSync('data/tmp', { recursive: true })

const what = process.argv[2] ?? 'all'

if (what === 'all' || what === 'chrome') {
  for (const channel of ['chrome', 'msedge']) {
    try {
      const t = Date.now()
      const browser = await chromium.launch({ channel, headless: true })
      const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } })
      await page.setContent('<svg width="1080" height="1920"><rect width="1080" height="1920" fill="#fc0"/><circle cx="540" cy="960" r="300"/></svg>')
      const t2 = Date.now()
      for (let i = 0; i < 10; i++) await page.screenshot({ type: 'jpeg', quality: 90 })
      const per = (Date.now() - t2) / 10
      console.log(`${channel}: OK version=${browser.version()} launch=${t2 - t}ms screenshot=${per.toFixed(0)}ms/frame`)
      await browser.close()
    } catch (e) {
      console.log(`${channel}: FAILED ${String(e).split('\n')[0]}`)
    }
  }
}

if (what === 'all' || what === 'kokoro') {
  try {
    const t = Date.now()
    const { KokoroTTS } = await import('kokoro-js')
    const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' })
    const t2 = Date.now()
    const audio = await tts.generate('What if every essay you ever wrote got scanned again, the day you graduate?', { voice: 'am_michael' })
    const secs = audio.audio.length / audio.sampling_rate
    console.log(`kokoro: OK load=${t2 - t}ms synth=${Date.now() - t2}ms audio=${secs.toFixed(2)}s rate=${audio.sampling_rate}`)
    console.log('voices:', Object.keys(tts.voices).join(','))
    writeFileSync('data/tmp/probe.wav', Buffer.from(audio.toWav()))
  } catch (e) {
    console.log(`kokoro: FAILED ${e?.stack ?? e}`)
  }
}
