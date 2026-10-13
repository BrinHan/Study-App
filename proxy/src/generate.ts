import { REQ, validateQuestions } from '../../shared/quiz'
import { callGemini, UpstreamError } from './gemini'
import { errorResponse, json, readJsonBody } from './http'
import { buildUserPrompt, PROMPT_VERSION, questionCounts, SYSTEM_PROMPT } from './prompt'
import type { Deps } from './router'
import { authenticate, limited, sha256hex } from './guard'

type Sentence = { id: string; text: string }

function parseSentences(v: unknown): Sentence[] | null {
  const list = (v as { sentences?: unknown } | null)?.sentences
  if (!Array.isArray(list) || list.length < 1 || list.length > REQ.maxSentences) return null
  const ids = new Set<string>()
  let total = 0
  const out: Sentence[] = []
  for (const s of list) {
    if (!s || typeof s !== 'object') return null
    const { id, text } = s as { id?: unknown; text?: unknown }
    if (typeof id !== 'string' || !REQ.idPattern.test(id) || ids.has(id)) return null
    if (typeof text !== 'string' || text.length < 1 || text.length > REQ.maxSentenceChars) return null
    ids.add(id)
    total += text.length
    out.push({ id, text })
  }
  return total > REQ.maxTotalChars ? null : out
}

export async function handleGenerate(req: Request, deps: Deps, origin: string): Promise<Response> {
  const { config } = deps
  const auth = await authenticate(req, deps, origin)
  if (auth instanceof Response) return auth
  const { ipHash } = auth

  const body = await readJsonBody(req)
  if (!body.ok) return errorResponse(body.code, body.code === 'too-large' ? 413 : 400, origin)
  const sentences = parseSentences(body.value)
  if (!sentences) return errorResponse('bad-request', 400, origin)

  const key = await sha256hex(PROMPT_VERSION + '|' + config.model + '|' + JSON.stringify(sentences))
  const hit = await deps.cache.get(key)
  if (hit) return json(hit, 200, origin)

  const block = await limited(deps, ipHash, origin)
  if (block) return block

  let result: unknown
  try {
    result = await callGemini({
      model: config.model, apiKey: config.geminiKey, system: SYSTEM_PROMPT,
      user: buildUserPrompt(sentences, questionCounts(sentences.length)), fetchFn: deps.fetch,
    })
  } catch (e) {
    if (e instanceof UpstreamError && e.status === 429) return errorResponse('busy', 503, origin, 30)
    return errorResponse('upstream', 502, origin)
  }

  const questions = validateQuestions(result, new Set(sentences.map((s) => s.id)))
  if (!questions.length) return errorResponse('upstream', 502, origin)
  const value = { questions }
  await deps.cache.put(key, value)
  return json(value, 200, origin)
}
