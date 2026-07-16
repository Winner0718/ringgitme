import { defineConfig } from 'vite';

// Port 5173 is fixed via --strictPort so the dev server can never drift onto
// 8788 (the protected D3C harness port). No proxies, no external requests.
export default defineConfig(({ mode }) => ({
  base: mode === 'preview' ? '/ringgitme-2.0-preview/' : '/',
  server: {
    host: '127.0.0.1',
  },
  build: {
    target: 'es2022',
    outDir: mode === 'preview' ? 'dist-preview' : 'dist',
    sourcemap: false,
  },
}));
