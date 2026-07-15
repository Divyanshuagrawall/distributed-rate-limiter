-- fixedWindow.lua
-- KEYS[1] = base key (e.g. "ratelimit:client123:/api/market-data")
-- ARGV[1] = window size in seconds
-- ARGV[2] = max requests allowed per window

local now = redis.call('TIME')
local now_sec = tonumber(now[1])
local window_size = tonumber(ARGV[1])
local window_id = math.floor(now_sec / window_size)

local key = KEYS[1] .. ':' .. window_id
local count = redis.call('INCR', key)

if count == 1 then
  redis.call('EXPIRE', key, window_size)
end

local limit = tonumber(ARGV[2])

if count > limit then
  return {0, count, limit}
else
  return {1, count, limit}
end