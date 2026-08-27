import path from 'node:path';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Vitest does not read .env.local the way Next.js does, so without this the
 * database-backed tests would silently skip on a machine that has credentials
 * sitting in .env.local. `loadEnv` with an empty prefix returns every key rather
 * than only NEXT_PUBLIC_/VITE_ ones.
 *
 * A real shell variable always wins, so `SANA_RLS_LIVE=1 bun run test:unit`
 * still overrides the file.
 */
const fileEnv = loadEnv('test', process.cwd(), '');
const envFromFile: Record<string, string> = {};
for (const [key, value] of Object.entries(fileEnv)) {
  if (process.env[key] === undefined) envFromFile[key] = value;
}

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    globals: true,
    env: envFromFile,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/lib/engine/**', 'src/lib/sync/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
