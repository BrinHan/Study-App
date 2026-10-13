import { REQ, validateQuestions, type AiQuestion, type ProxyErrorCode } from '../../../shared/quiz'
import { validateResolutions, validateTranscription, type ClarifyRequest, type Resolution, type TranscribeRequest, type TranscribeResponse } from '../../../shared/scan'

const TIMEOUT_MS = 45_000
const TRANSCRIBE_TIMEOUT_MS = 60_000
const RETRYABLE = new Set<string>(['busy', 'upstream', 'network'])

export class ProxyError extends Error {
  code: ProxyErrorCode | 'network'
  retryable: boolean
  retryAfterSec?: number
  constructor(code: ProxyErrorCode | 'network', message?: string, retryAfterSec?: number) {
    super(message ?? code)
    this.code = code
    this.retryable = RETRYABLE.has(code)
    this.retryAfterSec = retryAfterSec
  }
}

export class ProxyClient {
  private base: string
  private fetchFn: typeof fetch

  constructor(baseUrl: string, fetchFn?: typeof fetch) {
    this.base = baseUrl.replace(/\/+$/, '')
    this.fetchFn = fetchFn ?? ((input, init) => fetch(input, init))
  }

  private async post(path: string, body: unknown, session?: string, timeoutMs = TIMEOUT_MS): Promise<unknown> {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (session) headers.Authorization = `Bearer ${session}`
      let res: Response
      try {
        res = await this.fetchFn(this.base + path, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal })
      } catch {
        throw new ProxyError('network')
      }
      let json: unknown = null
      try { json = await res.json() } catch { /* non-JSON body */ }
      if (!res.ok) {
        const code = (json as { error?: unknown } | null)?.error
        const after = Number(res.headers.get('retry-after') ?? NaN)
        throw new ProxyError(typeof code === 'string' ? (code as ProxyErrorCode) : res.status >= 500 ? 'upstream' : 'bad-request', undefined, after >= 0 ? after : undefined)
      }
      return json
    } finally {
      clearTimeout(timer)
    }
  }

  async openSession(turnstileToken: string): Promise<string> {
    const r = (await this.post('/session', { turnstileToken })) as { session?: unknown } | null
    if (typeof r?.session !== 'string') throw new ProxyError('upstream', 'bad session response')
    return r.session
  }

  async generate(session: string, sentences: { id: string; text: string }[]): Promise<AiQuestion[]> {
    const r = (await this.post('/generate', { sentences }, session)) as { questions?: unknown } | null
    // Never trust the network: re-validate against the ids we actually sent.
    return validateQuestions(r?.questions, new Set(sentences.map((s) => s.id).filter((id) => REQ.idPattern.test(id))))
  }

  async transcribe(session: string, req: TranscribeRequest): Promise<TranscribeResponse> {
    const r = validateTranscription(await this.post('/transcribe', req, session, TRANSCRIBE_TIMEOUT_MS))
    if (!r) throw new ProxyError('upstream', 'bad transcription response')
    return r
  }

  async clarify(session: string, req: ClarifyRequest): Promise<Resolution[]> {
    return validateResolutions(await this.post('/clarify', req, session), req.items)
  }
}
