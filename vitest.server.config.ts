import { fileURLToPath } from 'node:url'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// NOTE: the task brief was written against the `@cloudflare/vitest-pool-workers`
// v3-era API (`defineWorkersConfig` + `/config` subpath + `poolOptions.workers`).
// The version actually installed by Step 1 (0.22.0, targeting Vitest 4) dropped
// that subpath in favor of a `cloudflareTest()` Vite plugin exported from the
// package root, and no longer has a `singleWorker` option. This mirrors the
// current official example: cloudflare/workers-sdk fixtures/vitest-plugin-examples/d1.
// All specified binding values (TEST_MIGRATIONS, HMAC_SECRET, ADMIN_AUTH_MODE,
// wrangler configPath) are preserved verbatim.
export default defineConfig(async () => {
  const migrationsDir = fileURLToPath(new URL('./migrations', import.meta.url))
  const migrations = await readD1Migrations(migrationsDir)

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            HMAC_SECRET: 'test-secret',
            ADMIN_AUTH_MODE: 'insecure-local',
          },
        },
      }),
    ],
    test: {
      name: 'server',
      // test/shared/** 는 순수 함수뿐이라 Workers 풀에서 그대로 돈다. 세 번째
      // 프로젝트를 만들 이유가 없어 서버 프로젝트에 얹는다.
      include: ['test/server/**/*.test.ts', 'test/shared/**/*.test.ts'],
      setupFiles: ['./test/server/setup.ts'],
    },
  }
})
