// Claude access for the writing agents. Every call uses structured output, so the reply is JSON
// matching the schema the caller supplies.
import Anthropic from '@anthropic-ai/sdk'
import { env } from './env.ts'
import { getSettings } from './store.ts'

let client: Anthropic | null = null
const api = () => (client ??= new Anthropic({ apiKey: env.anthropicKey }))

export const llmReady = () => env.anthropicKey.length > 0

let modelsCache: { at: number; ids: string[]; error?: string } | null = null
export async function listModels(): Promise<{ ids: string[]; error?: string }> {
  if (!llmReady()) return { ids: [] }
  if (modelsCache && Date.now() - modelsCache.at < 10 * 60 * 1000) return modelsCache
  try {
    const ids: string[] = []
    for await (const m of api().models.list({ limit: 100 })) ids.push(m.id)
    modelsCache = { at: Date.now(), ids }
  } catch (e) {
    modelsCache = { at: Date.now() - 9 * 60 * 1000, ids: [], error: e instanceof Error ? e.message : String(e) }
  }
  return modelsCache
}

/** Settings choice, then ANTHROPIC_MODEL, then the newest Sonnet-class model the key can use. */
export async function pickModel(): Promise<string> {
  const chosen = getSettings().model || env.anthropicModel
  if (chosen) return chosen
  const { ids, error } = await listModels()
  const auto = ids.find((id) => /sonnet/i.test(id)) ?? ids[0]
  if (!auto) throw new Error(`No Claude model available${error ? `: ${error}` : ''}. Set ANTHROPIC_MODEL in .env.`)
  return auto
}

export interface StructuredCall {
  system: string
  prompt: string
  tool: { name: string; description: string; schema: Record<string, unknown> }
  maxTokens?: number
  image?: { mediaType: 'image/jpeg' | 'image/png'; base64: string }
}

/**
 * Structured outputs accept a subset of JSON Schema: every object must be closed, and numeric
 * and array-length bounds are not enforced. Bounds are moved into the description so the model
 * still sees them; the callers' sanitizers enforce them afterwards.
 */
function strictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictSchema)
  if (!node || typeof node !== 'object') return node
  const src = node as Record<string, unknown>
  const out: Record<string, unknown> = {}
  const notes: string[] = []
  for (const [k, v] of Object.entries(src)) {
    if (k === 'minItems' || k === 'maxItems' || k === 'minimum' || k === 'maximum' || k === 'minLength' || k === 'maxLength') notes.push(`${k} ${String(v)}`)
    else if (k === 'properties' && v && typeof v === 'object') out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([p, s]) => [p, strictSchema(s)]))
    else out[k] = strictSchema(v)
  }
  if (src.type === 'object') out.additionalProperties = false
  if (notes.length) out.description = [src.description, `(${notes.join(', ')})`].filter(Boolean).join(' ')
  return out
}

/** One model call that must answer with JSON matching `tool.schema`. Returns the parsed object. */
export async function structured<T>(call: StructuredCall): Promise<T> {
  if (!llmReady()) throw new Error('ANTHROPIC_API_KEY is not set')
  const model = await pickModel()
  const content: Anthropic.ContentBlockParam[] = []
  if (call.image) content.push({ type: 'image', source: { type: 'base64', media_type: call.image.mediaType, data: call.image.base64 } })
  content.push({ type: 'text', text: `${call.prompt}\n\nTask: ${call.tool.description}` })
  const res = await api().messages.create({
    model,
    // Headroom on top of the answer itself: some models spend output tokens reasoning first.
    max_tokens: (call.maxTokens ?? 4096) + 6000,
    system: call.system,
    messages: [{ role: 'user', content }],
    output_config: { format: { type: 'json_schema', schema: strictSchema(call.tool.schema) as Record<string, unknown> } },
  })
  if (res.stop_reason === 'max_tokens') throw new Error(`Model ran out of tokens while writing ${call.tool.name}`)
  if (res.stop_reason === 'refusal') throw new Error(`Model declined to write ${call.tool.name}`)
  const text = res.content.filter((b) => b.type === 'text').map((b) => (b.type === 'text' ? b.text : '')).join('')
  if (!text.trim()) throw new Error(`Model returned no content for ${call.tool.name} (stop reason: ${res.stop_reason})`)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`Model returned invalid JSON for ${call.tool.name}`)
  }
}

/** Shared rules for every writing agent. */
export const WRITER_RULES = `Rules that always apply:
- Real people appear only in factual, respectful stories. Never invent quotes or events about a real person.
- Never make claims about competitors.
- Product claims are limited to the claims and features listed in the Product Brief. Do not invent numbers, awards or guarantees.
- A fictional scenario that could be mistaken for news must be framed as "what if".
- Plain spoken English. Short sentences. No hashtags, no emoji.`
