import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'client',
    environment: 'jsdom',
    // .ts 도 잡는다 — 붙여넣기 파서처럼 JSX 가 없는 클라이언트 로직까지
    // 확장자를 tsx 로 위장시킬 이유가 없다.
    include: ['test/client/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/client/setup.ts'],
    globals: true,
  },
})
