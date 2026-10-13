import { IMAGE_MIMES, ITEM_ID, SCAN, sniffImage, validateResolutions, validateTranscription, type ClarifyItem } from '../../shared/scan'
import { CLARIFY_SCHEMA, callGemini, TRANSCRIBE_SCHEMA, UpstreamError } from './gemini'
import { authenticate, limited, sha256hex } from './guard'
import { errorResponse, json, MAX_IMAGE_BODY_BYTES, readJsonBody } from './http'
import { buildClarifyPrompt, CLARIFY_PROMPT, PROMPT_VERSION, TRANSCRIBE_PROMPT } from './prompt'
import type { Deps } from './router'

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const upstream = (e: unknown, origin: string) => e instanceof UpstreamError && e.status === 429 ? errorResponse('busy', 503, origin, 30) : errorResponse('upstream', 502, origin)

function validImage(v: unknown): { image: string; mimeType: string } | null {
  const { image, mimeType } = (v ?? {}) as { image?: unknown; mimeType?: unknown }
  if (typeof mimeType !== 'string' || !IMAGE_MIMES.includes(mimeType)) return null
  if (typeof image !== 'string' || image.length > SCAN.maxImageB64 || !BASE64.test(image)) return null
  // the first 16 base64 chars decode to the first 12 bytes
  let head: Uint8Array
  try { head = Uint8Array.from(atob(image.slice(0, 16)), (c) => c.charCodeAt(0)) } catch { return null }
  return sniffImage(head) === mimeType ? { image, mimeType } : null
}

function validClarify(v: unknown): { text: string; items: ClarifyItem[] } | null {
  const { text, items } = (v ?? {}) as { text?: unknown; items?: unknown }
  if (typeof text !== 'string' || text.length < 1 || text.length > SCAN.maxClarifyChars) return null
  if (!Array.isArray(items) || items.length < 1 || items.length > SCAN.maxClarifyItems) return null
  const ids = new Set<string>()
  const out: ClarifyItem[] = []
  for (const it of items) {
    const { id, kind, raw, guesses } = (it ?? {}) as Record<string, unknown>
    if (typeof id !== 'string' || !ITEM_ID.test(id) || ids.has(id) || !text.includes(`⟦${id}:`)) return null
    if (kind !== 'w' && kind !== 's') return null
    if (typeof raw !== 'string' || raw.length > SCAN.maxValue) return null
    if (!Array.isArray(guesses) || guesses.length > 3 || !guesses.every((g) => typeof g === 'string' && g.length <= SCAN.maxValue)) return null
    ids.add(id)
    out.push({ id, kind, raw, guesses: guesses as string[] })
  }
  return { text, items: out }
}

export async function handleTranscribe(req: Request, deps: Deps, origin: string): Promise<Response> {
  const { config } = deps
  const auth = await authenticate(req, deps, origin)
  if (auth instanceof Response) return auth

  const body = await readJsonBody(req, MAX_IMAGE_BODY_BYTES)
  if (!body.ok) return errorResponse(body.code, body.code === 'too-large' ? 413 : 400, origin)
  const img = validImage(body.value)
  if (!img) return errorResponse('bad-request', 400, origin)

  const key = await sha256hex([PROMPT_VERSION, config.model, 'transcribe', JSON.stringify(img)].join('|'))
  const hit = await deps.cache.get(key)
  if (hit) return json(hit, 200, origin)

  const block = await limited(deps, auth.ipHash, origin)
  if (block) return block

  let result: unknown
  try {
    result = await callGemini({
      model: config.model, apiKey: config.geminiKey, system: TRANSCRIBE_PROMPT, user: 'Transcribe this page.', fetchFn: deps.fetch,
      schema: TRANSCRIBE_SCHEMA, image: { mimeType: img.mimeType, base64: img.image }, temperature: 0.1, thinkingBudget: 512,
    })
  } catch (e) {
    return upstream(e, origin)
  }
  const value = validateTranscription(result)
  if (!value) return errorResponse('upstream', 502, origin)
  await deps.cache.put(key, value)
  return json(value, 200, origin)
}

export async function handleClarify(req: Request, deps: Deps, origin: string): Promise<Response> {
  const { config } = deps
  const auth = await authenticate(req, deps, origin)
  if (auth instanceof Response) return auth

  const body = await readJsonBody(req)
  if (!body.ok) return errorResponse(body.code, body.code === 'too-large' ? 413 : 400, origin)
  const parsed = validClarify(body.value)
  if (!parsed) return errorResponse('bad-request', 400, origin)

  const key = await sha256hex([PROMPT_VERSION, config.model, 'clarify', JSON.stringify(parsed)].join('|'))
  const hit = await deps.cache.get(key)
  if (hit) return json(hit, 200, origin)

  const block = await limited(deps, auth.ipHash, origin)
  if (block) return block

  let result: unknown
  try {
    result = await callGemini({
      model: config.model, apiKey: config.geminiKey, system: CLARIFY_PROMPT, user: buildClarifyPrompt(parsed.text, parsed.items), fetchFn: deps.fetch,
      schema: CLARIFY_SCHEMA, temperature: 0.2, thinkingBudget: 1024,
    })
  } catch (e) {
    return upstream(e, origin)
  }
  const resolutions = validateResolutions(result, parsed.items)
  if (!resolutions.length) return errorResponse('upstream', 502, origin)
  const value = { resolutions }
  await deps.cache.put(key, value)
  return json(value, 200, origin)
}
