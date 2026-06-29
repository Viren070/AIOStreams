import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      SECRET_KEY: '0'.repeat(64),
      BASE_URL: 'http://localhost:3000',
      LOG_LEVEL: 'error',
    },
  },
});
