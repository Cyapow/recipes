import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['server/**/*.test.ts', 'web/**/*.test.{ts,tsx}'],
    environment: 'node', // web tests opt in with `// @vitest-environment jsdom`
  },
});
