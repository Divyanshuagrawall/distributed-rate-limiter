-- tokenBucket.lua
-- KEYS[1] = base key (e.g. "ratelimit:tokenbucket:client123:/api/orders")
-- ARGV[1] = capacity (max tokens the bucket can hold)
-- ARGV[2] = refill rate (tokens added per second)

local now = redis.call('TIME')
local now_sec = tonumber(now[1])
local now_micro = tonumber(now[2])
local now_precise = now_sec + (now_micro / 1000000)

local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])

local bucket_key = KEYS[1]

-- Read existing bucket state (tokens, last_refill_time), or initialize fresh
local bucket = redis.call('HMGET', bucket_key, 'tokens', 'last_refill')
local tokens = tonumber(bucket[1])
local last_refill = tonumber(bucket[2])

if tokens == nil then
  tokens = capacity
  last_refill = now_precise
end

-- Calculate how many tokens have refilled since last check
local elapsed = now_precise - last_refill
local refilled_tokens = elapsed * refill_rate
tokens = math.min(capacity, tokens + refilled_tokens)

-- Try to consume 1 token for this request
local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end

-- Save updated state back to Redis
redis.call('HMSET', bucket_key, 'tokens', tokens, 'last_refill', now_precise)
redis.call('EXPIRE', bucket_key, math.ceil(capacity / refill_rate) * 2)  -- safety cleanup if client goes silent

if allowed == 1 then
  return {1, math.floor(tokens), capacity}
else
  return {0, math.floor(tokens), capacity}
end