const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');

const redisClient = new Redis({
    host: '127.0.0.1',
    port:6379,
});

// Load the Lua script's text from disk, once, at startup
const fixedWindowScript = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'fixedWindow.lua'),
    'utf8'
);

const slidingWindowScript = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'slidingWindowCounter.lua'),
  'utf8'
);

const tokenBucketScript = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'tokenBucket.lua'),
  'utf8'
);

function fixedWindowLimiter({ windowSizeSec, limit, failMode = 'open' }) {
  return async function (req, res, next) {
    try {
      const clientId = req.ip;
      const routeKey = `ratelimit:${clientId}:${req.baseUrl}${req.path}`;

      const result = await redisClient.eval(
        fixedWindowScript,
        1,
        routeKey,
        windowSizeSec,
        limit
      );

      const [allowed, count, maxLimit] = result;

      res.set('X-RateLimit-Limit', maxLimit);
      res.set('X-RateLimit-Remaining', Math.max(0, maxLimit - count));

      if (allowed === 0) {
        res.set('Retry-After', windowSizeSec);
        return res.status(429).json({
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Try again in ${windowSizeSec} seconds.`,
        });
      }

      next();
    } catch (err) {
      console.error('Rate limiter error:', err);
      if (failMode === 'closed') {
        return res.status(503).json({
          error: 'Service Unavailable',
          message: 'Rate limiter backend is unreachable. Try again shortly.',
        });
      }
      next(); // fail open
    }
  };
}

function slidingWindowLimiter({ windowSizeSec, limit, failMode = 'open' }) {
  return async function (req, res, next) {
    try {
      const clientId = req.ip;
      const routeKey = `ratelimit:sliding:${clientId}:${req.baseUrl}${req.path}`;

      const result = await redisClient.eval(
        slidingWindowScript,
        1,
        routeKey,
        windowSizeSec,
        limit
      );

      const [allowed, count, maxLimit] = result;

      res.set('X-RateLimit-Limit', maxLimit);
      res.set('X-RateLimit-Remaining', Math.max(0, maxLimit - count));

      if (allowed === 0) {
        res.set('Retry-After', windowSizeSec);
        return res.status(429).json({
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Try again shortly.`,
        });
      }

      next();
    } catch (err) {
      console.error('Rate limiter error:', err);
      if (failMode === 'closed') {
        return res.status(503).json({
          error: 'Service Unavailable',
          message: 'Rate limiter backend is unreachable. Try again shortly.',
        });
      }
      next(); // fail open
    }
  };
}

function tokenBucketLimiter({ capacity, refillRate, failMode = 'open'  }) {
  return async function (req, res, next) {
    try {
      const clientId = req.ip;
      const routeKey = `ratelimit:tokenbucket:${clientId}:${req.baseUrl}${req.path}`;

      const result = await redisClient.eval(
        tokenBucketScript,
        1,
        routeKey,
        capacity,
        refillRate
      );

      const [allowed, tokensLeft, maxCapacity] = result;

      res.set('X-RateLimit-Limit', maxCapacity);
      res.set('X-RateLimit-Remaining', tokensLeft);

      if (allowed === 0) {
        const retryAfterSec = Math.ceil(1 / refillRate); // time until at least 1 token refills
        res.set('Retry-After', retryAfterSec);
        return res.status(429).json({
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Try again in ${retryAfterSec} seconds.`,
        });
      }

      next();
    }catch (err) {
      console.error('Rate limiter error:', err);
      if (failMode === 'closed') {
        return res.status(503).json({
          error: 'Service Unavailable',
          message: 'Rate limiter backend is unreachable. Try again shortly.',
        });
      }
      next(); // fail open
    }
  };
}

module.exports = { fixedWindowLimiter, slidingWindowLimiter, tokenBucketLimiter };