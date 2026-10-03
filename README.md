# ai-gateway

[![CI](https://github.com/brinch-dev/ai-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/brinch-dev/ai-gateway/actions/workflows/ci.yml)

An HTTP gateway that lets internal systems (ERP, CRM and so on) use Claude as a service. It handles client authentication, per-client rate limiting, response caching, and routing each request to the right model.

Callers ask for a task (summarize, classify, extract) instead of writing prompts and choosing models themselves. Prompts, model choice, API keys and cost control all stay in one place.

## Quick start

Requires Node 22.9 or later.

```bash
cp .env.example .env        # fill in ANTHROPIC_API_KEY and GATEWAY_API_KEYS
npm install
npm run dev                 # or: npm run build && npm start
npm test
```

Docker: `docker compose up --build`

## Example

```bash
curl -s localhost:8080/v1/analyze \
  -H "Authorization: Bearer $GATEWAY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "classify",
    "input": "Min ordre #4411 er ikke leveret, og ingen svarer på mail.",
    "complexity": "low",
    "options": { "labels": ["complaint", "question", "praise"] }
  }'
```

Response (token counts are illustrative):

```json
{ "result": "complaint", "model": "claude-haiku-4-5", "tier": "fast",
  "stopReason": "end_turn", "usage": { "inputTokens": 98, "outputTokens": 4 },
  "cached": false, "requestId": "3f1c..." }
```

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

## Architecture decisions

**Routing by task, not by model name.** Callers say how hard the task is and how fast they need an answer, never which model to use. That way model upgrades are a one-line change in `model-router.ts`, and no client has to be redeployed. Real-time or simple work goes to Haiku, which is the cheapest and fastest. Most traffic lands on Sonnet. Opus is used only for tasks marked `high`.

**Effort is set per tier.** Haiku doesn't accept the `effort` parameter, so it's left out there. Sonnet runs at `medium`. Opus runs at `high`, because its default is `medium`, which would undercut the reason for routing hard tasks to it.

**Refusals are their own error.** On the Sonnet and Opus tiers, a request Claude declines is first retried on another model through server-side fallbacks. If it is still refused, the gateway returns `422 refused` with a category. That keeps refusals separate from outages, so callers don't retry something that will never succeed.

**Input is treated as data.** Business text often contains things that look like instructions, such as forwarded emails or ticket text. The input is wrapped in `<input>` tags, and the system prompt says to analyze it, never follow it. The `instructions` field in `custom` tasks is trusted, because only authenticated clients can send it.

**No request or response bodies in the logs.** The gateway handles business data, so logs hold only metadata: request ID, client, tier, model, token counts and duration. Costs can still be followed per client without copying data into the log pipeline.

**Auth before body parsing.** API keys are checked before the JSON body is read, so unauthenticated callers can't make the server parse large bodies. Keys are compared as SHA-256 hashes with `timingSafeEqual`, which avoids leaking key prefixes through response timing.

**In-memory cache and rate limit for now.** A single instance needs no extra infrastructure. The cache key is a hash of model, prompt and max tokens. Truncated (`max_tokens`) responses are never cached. Both the cache and the rate limit are small classes, so they can move to Redis when the gateway runs more than one instance.

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
