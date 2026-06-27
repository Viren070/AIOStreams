const env = process.env as Record<string, string | undefined>;
env.NODE_ENV ??= 'test';
env.SECRET_KEY ??= '0'.repeat(64); // 64-char hex required by the validator
env.BASE_URL ??= 'http://localhost:3000'; // Vite-injected '/' would fail it
env.LOG_LEVEL ??= 'error'; // keep test output clean; override to debug locally
