import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    // Without this the minifier rewrites `@media (max-width: 359px)` as `@media (width<=359px)`, the range syntax
    // Safari only understands from 16.4. The one phone that rule exists for is a 320px iPhone SE, which stops at
    // iOS 15, so it would have been the only device to ignore it. The app already needs 15.4 for :has() and dvh.
    cssTarget: 'safari15',
  },
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
