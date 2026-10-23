import { defineConfig } from 'vitest/config';

// Unit tests for the pure business logic in src/lib. No DOM and no Supabase: tests that need a
// device time zone set process.env.TZ themselves, so results never depend on the machine's zone.
export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
