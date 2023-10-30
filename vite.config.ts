/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    __DEV__: 'true',
  },
  resolve: {
    alias: {
      'media-captions': '/src/index',
    },
  },
  // https://vitest.dev/config
  test: {
    setupFiles: ['tests/polyfills.ts'],
    include: ['tests/**/*.test.ts'],
    globals: true,
    testTimeout: 2500,
  },
});
