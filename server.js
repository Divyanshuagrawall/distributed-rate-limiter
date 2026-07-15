const express = require('express');
const { fixedWindowLimiter, slidingWindowLimiter, tokenBucketLimiter } = require('./middleware/rateLimiter');
const app = express();

app.get('/api/market-data', 
    fixedWindowLimiter({windowSizeSec: 30, limit:10}),
    (req, res)=>{
        res.json({message: 'Market Data Here', timestamp: Date.now()});
    }
);

app.post(
  '/api/orders',
  fixedWindowLimiter({ windowSizeSec: 5, limit: 3 }),
  (req, res) => {
    res.json({ message: 'Order placed', timestamp: Date.now() });
  }
);

app.post(
  '/api/orders-sliding',
  slidingWindowLimiter({ windowSizeSec: 5, limit: 3 }),
  (req, res) => {
    res.json({ message: 'Order placed (sliding)', timestamp: Date.now() });
  }
);

app.post(
  '/api/orders-tokenbucket',
  tokenBucketLimiter({ capacity: 5, refillRate: 1 }),
  (req, res) => {
    res.json({ message: 'Order placed (token bucket)', timestamp: Date.now() });
  }
);

app.post(
  '/api/orders-failclosed-test',
  fixedWindowLimiter({ windowSizeSec: 30, limit: 3, failMode: 'closed' }),
  (req, res) => {
    res.json({ message: 'Order placed', timestamp: Date.now() });
  }
);

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});