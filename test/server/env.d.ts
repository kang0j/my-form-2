import type { D1Migration } from '@cloudflare/vitest-pool-workers'

// NOTE: this version of @cloudflare/vitest-pool-workers (0.22.0, Vitest 4) types
// `import { env } from 'cloudflare:test'` as `Cloudflare.Env` rather than the
// v3-era `cloudflare:test`-module `ProvidedEnv` interface the brief was written
// against. `DB` and `ADMIN_AUTH_MODE` are already merged into `Cloudflare.Env` by
// the generated `worker-configuration.d.ts` (from `wrangler types`); this only
// adds the two bindings that file cannot know about: the `HMAC_SECRET` secret and
// the test-only `TEST_MIGRATIONS` binding.
declare global {
  namespace Cloudflare {
    interface Env {
      HMAC_SECRET: string
      TEST_MIGRATIONS: D1Migration[]
    }
  }
}

export {}
