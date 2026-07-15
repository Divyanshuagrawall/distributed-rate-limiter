# Distributed Rate Limiter

A Node.js/Express rate-limiting middleware backed by Redis, built to solve the core
problem naive rate limiters get wrong: **correctness under horizontal scaling**. A simple
in-memory counter breaks the moment an API runs across multiple instances behind a load
balancer — each instance tracks its own count, so the real limit becomes meaningless
(`limit × number of instances`, or effectively no limit at all).

This project uses **atomic Redis Lua scripts** (`EVAL`) so every check-and-increment is a
single indivisible operation on the Redis server — immune to race conditions between
instances and to clock drift (using Redis's own `TIME` command rather than each server's
local clock).

Three strategies are implemented and empirically compared under real concurrent load,
not just described in theory.

## Strategies

| Strategy | File | Best for | Key property |
|---|---|---|---|
| Fixed window | `scripts/fixedWindow.lua` | Simple cases, low-stakes reads | Simple, but allows up to 2-3x burst at window boundaries |
| Sliding window counter | `scripts/slidingWindowCounter.lua` | Reads needing accurate limits | Blends current + previous window by time-overlap; no boundary burst |
| Token bucket | `scripts/tokenBucket.lua` | Write-heavy, bursty traffic | Continuous refill, no fixed windows, tolerates short bursts by design |

All three:
- Run as one atomic Redis Lua script per request (`EVAL`) — no separate "check" then
  "increment" round trips, so no window for a race condition to slip through.
- Use `redis.call('TIME')` inside the script, not `Date.now()` in application code, so
  every app instance agrees on the same clock regardless of local clock drift.
- Support a configurable `failMode: 'open' | 'closed'`, governing behavior if Redis
  itself becomes unreachable — fail-open lets requests through unprotected (prioritizes
  availability), fail-closed rejects with `503` (prioritizes protection). Tested against
  a real Redis outage (`docker stop` on the Redis container mid-run): fail-closed
  correctly returned `503` while Redis was down and resumed normal operation the moment
  Redis came back, with no server restart required.

## Usage

```js
const express = require('express');
const { fixedWindowLimiter, slidingWindowLimiter, tokenBucketLimiter } = require('./middleware/rateLimiter');

const app = express();

app.get('/api/market-data',
  fixedWindowLimiter({ windowSizeSec: 30, limit: 10 }),
  (req, res) => res.json({ message: 'Market data here' })
);

app.post('/api/orders',
  tokenBucketLimiter({ capacity: 10, refillRate: 2, failMode: 'closed' }),
  (req, res) => res.json({ message: 'Order placed' })
);
```

Each limiter is a middleware **factory** — call it with config to get the actual Express
middleware, so different routes can use different strategies and limits.

Blocked requests receive:
```
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 0
Retry-After: 30

{"error":"Too Many Requests","message":"Rate limit exceeded. Try again in 30 seconds."}
```

## Setup

```bash
npm install
docker run -d --name ratelimiter-redis -p 6379:6379 redis:7-alpine
node server.js
```

## Load testing

```bash
node loadtest.js
```

Uses [autocannon](https://github.com/mcollina/autocannon) to fire concurrent requests
against the running server and report how many were allowed vs. blocked.

## Evidence: algorithm comparison under load

10 concurrent connections, 7s duration, spanning a window boundary, against identical
`limit: 3, windowSizeSec: 5` config:

| Run | Fixed window (`2xx` allowed) | Sliding window counter (`2xx` allowed) |
|---|---|---|
| 1 | 6 | 3 |
| 2 | 9 | 3 |
| 3 | 6 | 3 |
| 4 | 6 | 3 |
| 5 | 9 | 3 |

Fixed window let through **2-3x** the configured limit whenever a test happened to
straddle a window boundary — an inherent property of the algorithm (a client can send a
full quota in the last second of one window and another full quota in the first second
of the next), not a bug. Sliding window counter held the exact limit every time under
identical concurrent load, by blending the previous window's count (weighted by time
overlap) into the current window's check.

Token bucket (`capacity: 5, refillRate: 1`) under the same style of flood: `11, 10, 9`
allowed across three runs — consistent with intended behavior (burst of `capacity`, then
a steady trickle for the remainder of the test), holding correctly despite ~28,000
concurrent requests per run.

## Real-world integration

This middleware was integrated into and load-tested against a real deployed trading
platform's order-placement endpoint (previously completely unprotected). Results:

| | With rate limiter | Without rate limiter |
|---|---|---|
| Total requests attempted (5s) | 22,625 | 2,480 |
| Successful | 11 | 24 (capped by business logic, not by protection) |
| Rejected | 22,614 | 2,456 |
| Avg latency | 1.67 ms | 19.64 ms (~12x higher) |

Without protection, every request does full work (database lookups, balance checks,
record creation) before any rejection can happen — so far fewer requests fit in the same
window, and average latency rises sharply. With the limiter in place, the vast majority
of flood traffic is rejected via a single atomic Redis check in 1-2ms, before any
expensive work happens.

## Design notes / tradeoffs

- **Sliding window counter is a weighted approximation**, not a perfectly exact sliding
  log (which would require storing a timestamp per request — unbounded memory growth
  under sustained load). This tradeoff mirrors production systems like Cloudflare's rate
  limiter, and was a deliberate choice.
- **Rate limiting is keyed by client IP** (`req.ip`) in this implementation. For
  authenticated routes, keying by user ID instead would be more accurate (one user,
  multiple IPs, is still one client) — a reasonable next step, not implemented here to
  keep the middleware auth-agnostic.
- **One shared Redis instance is used for all strategies and all routes**, distinguished
  by key prefix (`ratelimit:...`, `ratelimit:sliding:...`, `ratelimit:tokenbucket:...`).
  This mirrors how Redis is used in real systems — one instance backing multiple
  concerns (caching, queues, rate limiting) is standard, not a compromise.