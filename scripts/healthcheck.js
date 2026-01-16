#!/usr/bin/env node
import http from 'http';

const PORT = process.env.PORT || 3000;

function checkHealth(retries = 0) {
  const options = {
    host: 'localhost',
    port: PORT,
    path: '/api/v1/health',
    timeout: 15000,
    method: 'GET',
  };

  const request = http.request(options, (res) => {
    if (res.statusCode === 200) {
      console.log('✓ Health check passed');
      process.exit(0);
    } else {
      console.error(`✗ Unexpected status code: ${res.statusCode}`);
      process.exit(1);
    }
  });

  request.on('error', (err) => {
    console.error('✗ Health check failed:', err.message);
    process.exit(1);
  });

  request.on('timeout', () => {
    request.destroy();
    console.error('✗ Health check timeout');
    process.exit(1);
  });

  request.end();
}

checkHealth();
