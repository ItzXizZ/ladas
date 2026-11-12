// Checks that the keys in .env work, without printing them. Run: npx tsx scripts/check-keys.ts
import { env } from '../server/env.ts'
import { listModels, pickModel, structured } from '../server/llm.ts'

if (!env.anthropicKey) console.log('anthropic: no key set')
else {
  const { ids, error } = await listModels()
  if (error) console.log(`anthropic: models list FAILED: ${error}`)
  else {
    console.log(`anthropic: OK, ${ids.length} models: ${ids.join(', ')}`)
    try {
      const model = await pickModel()
      const res = await structured<{ word: string }>({
        system: 'You answer by calling the tool.',
        prompt: 'Save the word "ready".',
        tool: { name: 'save_word', description: 'Save one word', schema: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'] } },
        maxTokens: 100,
      })
      console.log(`anthropic: tool call OK with ${model} -> ${JSON.stringify(res)}`)
    } catch (e) {
      console.log(`anthropic: tool call FAILED: ${e instanceof Error ? e.message : e}`)
    }
  }
}

if (!env.elevenKey) console.log('elevenlabs: no key set')
else {
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': env.elevenKey }, signal: AbortSignal.timeout(15000) })
    const body = await res.text()
    if (!res.ok) console.log(`elevenlabs: voices FAILED: HTTP ${res.status} ${body.slice(0, 300)}`)
    else {
      const voices = (JSON.parse(body) as { voices: { voice_id: string; name: string; category: string; labels?: Record<string, string>; preview_url?: string }[] }).voices
      console.log(`elevenlabs: OK, ${voices.length} voices`)
      for (const v of voices.slice(0, 12)) console.log(`  ${v.voice_id} ${v.name} [${v.category}] ${JSON.stringify(v.labels ?? {})} preview=${!!v.preview_url}`)
    }
    const sub = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': env.elevenKey }, signal: AbortSignal.timeout(15000) })
    if (sub.ok) {
      const s = (await sub.json()) as { tier?: string; character_count?: number; character_limit?: number }
      console.log(`elevenlabs: tier=${s.tier} characters used ${s.character_count}/${s.character_limit}`)
    } else console.log(`elevenlabs: subscription lookup HTTP ${sub.status}`)
  } catch (e) {
    console.log(`elevenlabs: FAILED: ${e instanceof Error ? e.message : e}`)
  }
}
