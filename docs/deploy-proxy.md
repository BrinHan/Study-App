# Deploying the Margin AI proxy

The proxy is a small Cloudflare Worker in `proxy/`. It holds the Gemini API key so the key never reaches the browser. The app calls it at `/session`, `/generate`, `/transcribe` and `/clarify`.

> **Stay on free tiers. Never add billing.**
> - Create the Google API key in a **new project with no billing account**. Never click "Set up billing" on it. Without billing, Google rejects requests past the free quota. It does not charge you.
> - Stay on **Cloudflare Workers Free**. It has no overage charges. Requests simply fail past the daily limit.
> - If you ever see a prompt to add a card, close it. The proxy works without one.

If the proxy is not deployed, the app still works. It uses its built-in question generator.

## 1. Google AI Studio: get a key

1. Open Google AI Studio and create an API key in a **new project with no billing account**.
2. In Google Cloud Console, go to APIs & Services, then Credentials. Open the key and restrict it to the **Generative Language API** only.
3. In AI Studio, find the free-tier requests per day for the model in `proxy/wrangler.toml` (`GEMINI_MODEL`, default `gemini-2.5-flash`). If the current free-tier Flash model is different, change `GEMINI_MODEL`.
4. Set `GLOBAL_PER_DAY` in `proxy/wrangler.toml` to about 80% of that number. The default is `800`.

## 2. Cloudflare: account and Turnstile

1. Create a free Cloudflare account. Stay on **Workers Free**.
2. Create a Turnstile widget in **Managed** mode. Add the hostnames `brinhan.github.io` and `localhost`.
3. Copy the **sitekey** (public) and the **secret**.

## 3. Deploy the Worker

```bash
cd proxy
npm ci
npx wrangler login
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put SESSION_SECRET
npm run deploy
```

- Paste the Google key, the Turnstile secret and a random value when asked.
- Make the random value with `openssl rand -base64 32`.
- `npm run deploy` prints a `*.workers.dev` URL. Note it.
- Never put these three values in git, in `src/`, or in any `VITE_*` variable.

The other settings live in `proxy/wrangler.toml` under `[vars]`:

| Variable | Default | Meaning |
|---|---|---|
| `ENABLED` | `true` | Kill switch. `false` makes every request return `disabled`. |
| `ALLOWED_ORIGINS` | `https://brinhan.github.io` | Browser origins allowed to call the proxy, comma-separated. Local dev origins come from `proxy/.dev.vars`. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Model used for all calls. |
| `IP_PER_HOUR` | `40` | Requests per IP per hour. |
| `IP_PER_DAY` | `120` | Requests per IP per day. |
| `GLOBAL_PER_MINUTE` | `8` | Requests per minute across everyone. Past it the proxy answers `busy` with `Retry-After`, and the app waits and retries. |
| `GLOBAL_PER_DAY` | `800` | Requests per day across everyone. Set to about 80% of the free quota. |
| `SESSION_TTL_SEC` | `1800` | How long a Turnstile session token lasts. 30 minutes covers a 20-page scan that waits out the minute limit. |

When a limit is reached, the proxy answers with a `Retry-After` header:

- `IP_PER_HOUR` or `IP_PER_DAY`: `429 rate-limited`. The app stops sending for this import.
- `GLOBAL_PER_MINUTE`: `503 busy`. The app waits (at most 60 seconds) and retries, up to 3 times per request.
- `GLOBAL_PER_DAY`: `503 budget`. The app stops sending for this import.

Per-IP limits count IPv6 clients by their /64 prefix.

One handwritten import can use about 25 requests (up to 20 pages, one clarify call, and the question calls). That is why the per-IP limits are higher than you might expect.

## 4. Connect the site

In the GitHub repo, go to Settings, then Secrets and variables, then Actions, then **Variables**. Use variables, not secrets. Both values are public by design.

- `VITE_AI_PROXY_URL` = the Worker URL from step 3
- `VITE_TURNSTILE_SITEKEY` = the Turnstile sitekey

Then re-run the "Deploy to GitHub Pages" workflow.

## Optional: custom domain for caching

The proxy caches generated questions for a week, so importing the same notes again costs nothing. This uses the Workers Cache API. **The Cache API does nothing on `*.workers.dev` hostnames.** It only works when the Worker is served from a custom domain, meaning a route on a zone you own in Cloudflare.

On `workers.dev`, repeat imports are not cached. Every request counts against the limiter and the Gemini quota. The app still works, but you will reach the limits sooner.

To get caching, add a route or custom domain for the Worker in the Cloudflare dashboard (Workers, margin-proxy, Settings, Domains and Routes), then set `VITE_AI_PROXY_URL` to that domain. This needs a domain you own. It is not required.

## Local development

```bash
cp .env.example .env.local
cp proxy/.dev.vars.example proxy/.dev.vars
```

Edit `proxy/.dev.vars` and put a real free Gemini key in `GEMINI_API_KEY`. The Turnstile and session values in the example are test values and work locally. `.env.local` and `proxy/.dev.vars` are gitignored.

`wrangler dev` lets `proxy/.dev.vars` override `[vars]`. The example sets `ALLOWED_ORIGINS` to `http://localhost:5173,http://localhost:4173` so the dev and preview servers can call the local proxy. The deployed Worker allows only `https://brinhan.github.io`.

Then run the proxy and the app in two terminals:

```bash
cd proxy && npx wrangler dev   # http://localhost:8787
```

```bash
npm run dev                    # http://localhost:5173
```

`npm install` in `proxy/` may warn that the `workerd` postinstall script needs approval. If `wrangler dev` fails, approve the script and run it again.

## Kill switch

Cloudflare dashboard, then Workers, then margin-proxy, then Settings, then Variables. Set `ENABLED` to `false` and Deploy. Every request then returns `disabled`, and the app falls back to the built-in generator right away.

From a terminal instead:

```bash
cd proxy
npx wrangler deploy --var ENABLED:false
```

To turn it back on, set `ENABLED` to `true` and deploy again.

## If the key leaks

1. Delete the key in AI Studio.
2. Create a new key (still in a project with no billing) and restrict it to the Generative Language API.
3. Run `npx wrangler secret put GEMINI_API_KEY` in `proxy/` and paste the new key.

## Monitoring

- Cloudflare dashboard, Workers, margin-proxy, **Logs**. The proxy logs only error codes and timings. It never logs notes, request bodies or raw IP addresses.
- AI Studio, **Usage**. Check it against your `GLOBAL_PER_DAY` value.

## Handwriting and scanned PDFs

Photos and scanned PDF pages are sent to Google Gemini for transcription. Things to know when you run the proxy:

- At most 20 AI-read pages per import.
- Images are downscaled in the browser before upload (1600 px on the longest side, JPEG).
- Per-IP limits are 40 an hour and 120 a day. Each page and the clarify pass count as one request.
- A page that can't be read is reported in the import progress and marked in the transcript. The rest of the import goes ahead.
- `/transcribe` returns the model's text (up to 8000 characters per page) by design. Turnstile, the rate limits and response validation bound what it can be used for.
- A scanned PDF needs an internet connection and a configured proxy. Without them the app shows the "scanned" error.

## Smoke test after deploying

1. Open the Pages site and import `samples/cell-biology.pdf`. You should get AI questions.
2. A request from another origin should be refused:

```bash
curl -i -X POST <worker-url>/generate -H "Origin: https://evil.example"
```

Expected: `403`.

3. A request without a session should be refused:

```bash
curl -i -X POST <worker-url>/generate -H "Origin: https://brinhan.github.io" -d '{}'
```

Expected: `401` with the code `session`.

4. Read about 15 generated questions. If more than 2 have an answer that is obvious from the wording, or any is a copied sentence with a blank, edit `SYSTEM_PROMPT` in `proxy/src/prompt.ts`, change `PROMPT_VERSION` to `v2` (this also clears the cache), and redeploy.
