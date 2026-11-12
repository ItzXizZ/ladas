// Runs the Kokoro voice model off the main thread. Synthesis keeps a CPU busy for seconds per sentence;
// on the main thread that froze every web request until the whole narration was recorded.
// Plain JavaScript on purpose: worker threads do not get the TypeScript loader the main thread runs under.
import { setPriority } from 'node:os'
import { parentPort } from 'node:worker_threads'

const KOKORO_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'

// On Linux niceness is per thread and inherited by threads started later, so this lowers this thread and the
// model's thread pool without touching the web server. Elsewhere it would renice the whole process.
if (process.platform === 'linux') {
  try { setPriority(15) } catch { /* not allowed: run at normal priority */ }
}

let kokoro = null
function loadKokoro() {
  kokoro ??= (async () => {
    // On a shared host the model sees every core of the machine, not the few this service owns, and
    // starts a thread pool to match. Build it ourselves so the thread count can be capped (KOKORO_THREADS).
    const tf = await import('@huggingface/transformers')
    const { KokoroTTS } = await import('kokoro-js')
    const threads = Math.max(1, Math.round(Number(process.env.KOKORO_THREADS)) || 2)
    const [model, tokenizer] = await Promise.all([
      tf.StyleTextToSpeech2Model.from_pretrained(KOKORO_ID, { dtype: 'q8', device: 'cpu', session_options: { intra_op_num_threads: threads, inter_op_num_threads: 1 } }),
      tf.AutoTokenizer.from_pretrained(KOKORO_ID),
    ])
    return new KokoroTTS(model, tokenizer)
  })()
  kokoro.catch(() => { kokoro = null })
  return kokoro
}

parentPort.on('message', async ({ id, text, voice }) => {
  try {
    const out = await (await loadKokoro()).generate(text, { voice, speed: 1.06 })
    const audio = new Float32Array(out.audio)
    parentPort.postMessage({ id, audio, rate: out.sampling_rate }, [audio.buffer])
  } catch (e) {
    parentPort.postMessage({ id, error: e instanceof Error ? e.message : String(e) })
  }
})
