import type { GenerateResponse } from '../../shared/quiz'
import { readConfig, type Env } from './config'
import { handle } from './router'
import type { Limiter } from './limiter-do'

export { Limiter } from './limiter-do'

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const cache = (caches as unknown as { default: Cache }).default
    const url = (key: string) => `https://cache.margin.invalid/${key}`
    return handle(req, {
      config: readConfig(env),
      fetch,
      limiter: { check: (ipHash, nowMs) => (env.LIMITER as DurableObjectNamespace<Limiter>).get(env.LIMITER.idFromName('global')).check(ipHash, nowMs) },
      cache: {
        async get(key) {
          const hit = await cache.match(url(key))
          return hit ? ((await hit.json()) as GenerateResponse) : undefined
        },
        async put(key, value) {
          ctx.waitUntil(cache.put(url(key), new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=604800' } })))
        },
      },
      now: Date.now,
      ip: req.headers.get('CF-Connecting-IP') ?? '',
    })
  },
}
