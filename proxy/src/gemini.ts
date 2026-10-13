const str = { type: 'STRING' }
const strs = { type: 'ARRAY', items: str }

export const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    questions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          kind: { type: 'STRING', enum: ['mcq', 'flashcard'] },
          question: str,
          answer: str,
          distractors: strs,
          distractorExplanations: strs,
          explanation: str,
          hint: str,
          sourceIds: strs,
        },
        required: ['kind', 'question', 'answer', 'distractors', 'distractorExplanations', 'explanation', 'hint', 'sourceIds'],
      },
    },
  },
  required: ['questions'],
}

export const TRANSCRIBE_SCHEMA = {
  type: 'OBJECT',
  properties: { text: str, legible: { type: 'BOOLEAN' } },
  required: ['text', 'legible'],
}

export const CLARIFY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    resolutions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { id: str, value: str, confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] } },
        required: ['id', 'value', 'confidence'],
      },
    },
  },
  required: ['resolutions'],
}

export class UpstreamError extends Error {
  constructor(public status: number) { super('upstream ' + status) }
}

export interface GeminiOptions {
  model: string
  apiKey: string
  system: string
  user: string
  fetchFn: typeof fetch
  timeoutMs?: number
  schema?: object
  image?: { mimeType: string; base64: string }
  temperature?: number
  thinkingBudget?: number
}

export async function callGemini(o: GeminiOptions): Promise<unknown> {
  const body = {
    systemInstruction: { parts: [{ text: o.system }] },
    contents: [{ role: 'user', parts: [...(o.image ? [{ inline_data: { mime_type: o.image.mimeType, data: o.image.base64 } }] : []), { text: o.user }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: o.schema ?? GEMINI_SCHEMA, temperature: o.temperature ?? 0.4, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: o.thinkingBudget ?? 1024 } },
  }
  let res: Response
  try {
    res = await o.fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${o.model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': o.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(o.timeoutMs ?? 40000),
    })
  } catch {
    throw new UpstreamError(502)
  }
  if (res.status === 429) throw new UpstreamError(429)
  if (!res.ok) throw new UpstreamError(502)
  try {
    const env = (await res.json()) as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] }
    const text = env.candidates?.[0]?.content?.parts?.[0]?.text
    if (typeof text !== 'string') throw new Error('no text')
    return JSON.parse(text)
  } catch {
    throw new UpstreamError(502)
  }
}
