-- slidingWindowCounter.lua
-- KEYS[1] = base key (e.g. "ratelimit:client123:/api/orders")
-- ARGV[1] = window size in seconds
-- ARGV[2] = max requests allowed per window

local now = redis.call('TIME')
local now_sec = tonumber(now[1])
local now_micro = tonumber(now[2])
local now_precise = now_sec + (now_micro / 1000000)  -- full precision, fractional seconds

local window_size = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])

local current_window_id = math.floor(now_precise / window_size)
local previous_window_id = current_window_id - 1

local current_key = KEYS[1] .. ':' .. current_window_id
local previous_key = KEYS[1] .. ':' .. previous_window_id

-- How far into the current window are we, as a fraction (0 to 1)?
local elapsed_in_current = now_precise - (current_window_id * window_size)
local elapsed_fraction = elapsed_in_current / window_size
local overlap_fraction = 1 - elapsed_fraction

-- Read previous window's count (0 if it doesn't exist / already expired)
local previous_count = tonumber(redis.call('GET', previous_key)) or 0

-- Increment current window's count
local current_count = redis.call('INCR', current_key)
if current_count == 1 then
  redis.call('EXPIRE', current_key, window_size * 2)  -- keep around long enough to be read as "previous" later
end

-- Weighted estimate
local estimated_count = (previous_count * overlap_fraction) + current_count

if estimated_count > limit then
  return {0, math.floor(estimated_count), limit}
else
  return {1, math.floor(estimated_count), limit}
end