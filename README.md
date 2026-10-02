# ai-gateway

An HTTP gateway that lets internal systems (ERP, CRM and so on) use Claude as a service. It handles client authentication, per-client rate limiting, response caching, and routing each request to the right model.

## Quick start

```bash
cp .env.example .env        # fill in ANTHROPIC_API_KEY and GATEWAY_API_KEYS
npm install
npm run dev                 # or: npm run build && npm start
npm test
```

Docker: `docker compose up --build`

## API

`GET /healthz`: no auth.

`POST /v1/analyze`: send `Authorization: Bearer <secret>` (or `x-api-key`).

```json
{
  "task": "summarize | classify | extract | custom",
  "input": "text to analyze",
  "complexity": "low | medium | high",          // default medium
  "latency": "realtime | standard | batch",      // default standard
  "options": {
    "labels": ["a", "b"],          // required for classify
    "fields": ["name", "date"],    // required for extract
    "instructions": "...",         // required for custom
    "maxTokens": 4000              // optional, 256–16000
  },
  "cache": true
}
```

Response:

```json
{ "result": "...", "model": "claude-sonnet-5-5", "tier": "balanced",
  "stopReason": "end_turn", "usage": { "inputTokens": 120, "outputTokens": 40 },
  "cached": false, "requestId": "..." }
```

| Status | Meaning |
|---|---|
| 400 | Validation failed (`issues` lists the fields) |
| 401 | Missing or invalid API key |
| 422 | Claude declined the request (`category`) |
| 429 | Client exceeded its rate limit (see the `Retry-After` header) |
| 502 / 503 | Upstream error / Anthropic rate limit |

## Model routing

| Condition | Tier | Model |
|---|---|---|
| `latency: realtime` or `complexity: low` | fast | `claude-haiku-4-5` |
| `complexity: medium` | balanced | `claude-sonnet-5-5` (effort `medium`) |
| `complexity: high` | powerful | `claude-opus-5-5` (effort `high`) |

Requests on the Sonnet and Opus tiers enable server-side refusal fallbacks (`fallbacks: "default"`), so the API can retry a refused request on another model. `src/services/model-router.ts` holds the model map.

## Design notes

- **Prompt injection:** input goes inside `<input>` tags, and the system prompt tells Claude to treat it as data. Caller-supplied `instructions` in `custom` tasks are trusted, because only authenticated clients can send them.
- **Logging:** logs are structured JSON with request ID, client, tier, model and token counts. Request and response bodies are never logged.
- **Cache:** an in-memory LRU cache with TTL. The key is a hash of model, prompt and max tokens. Truncated (`max_tokens`) responses are not cached. Replace it with Redis to run more than one instance.
- **Rate limit:** the limit is also in memory, per client ID. Use Redis for multiple instances.

## Structure

```
src/
  index.ts              server bootstrap + graceful shutdown
  app.ts                Express app wiring (testable without listening)
  config.ts             env parsing/validation
  routes/               health, analyze
  middleware/           auth, rate-limit, logging
  services/             llm (Anthropic SDK), cache, model-router
  prompts/templates.ts  per-task prompt builders
tests/                  vitest + supertest (LLM is faked)
```
