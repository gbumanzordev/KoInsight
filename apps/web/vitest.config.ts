// Phase 8 Plan 01 Wave 0: web vitest scaffold for the new RED tests.
// jsdom + RTL setup; no test files existed in apps/web before this phase.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
