import { defineConfig } from 'vite';

// Port 5173 is fixed via --strictPort so the dev server can never drift onto
// 8788 (the protected D3C harness port). No proxies, no external requests.
export default defineConfig({
  server: {
    host: '127.0.0.1',
  },
  build: {
    target: 'es2022',
  },
});
