const autocannon = require('autocannon');

async function runLoadTest({ url, method, connections, duration }) {
  const result = await autocannon({
    url,
    method,
    connections,   // how many simultaneous "clients" firing requests
    duration,      // how many seconds to run
  });

  // autocannon buckets results by status code family (2xx, 4xx, etc.)
  console.log('--- Load Test Results ---');
  console.log(`Target: ${method} ${url}`);
  console.log(`Duration: ${duration}s, Connections: ${connections}`);
  console.log(`Total requests: ${result.requests.total}`);
  console.log(`2xx (allowed): ${result['2xx']}`);
  console.log(`Non-2xx (blocked/other): ${result.non2xx}`);
  console.log(`Latency (avg): ${result.latency.average}ms`);
}

// Run it against the orders endpoint
runLoadTest({
  url: 'http://localhost:3000/api/orders-tokenbucket',
  method: 'POST',
  connections: 10,
  duration: 7,
});