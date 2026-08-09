import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolve = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@tests': resolve('./tests'),
      '@': resolve('./src'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // `*.contract.ts` files export reusable suites; they are not tests themselves.
    exclude: ['**/node_modules/**', '**/*.contract.ts'],
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/main.ts',
        'src/composition/**',
        'src/application/ports/**',
        'src/**/*.d.ts',
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
        // The domain is the heart of the system: it is pure, fast to test,
        // and therefore held to a stricter bar than the edges.
        'src/domain/**/*.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
      },
    },
  },
});
