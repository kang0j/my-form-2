import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    // 카카오톡 인앱 브라우저의 구형 안드로이드 WebView 가 파싱할 수 있는
    // 문법까지만 내보낸다. 최신 타깃(esnext 기본값)은 여기서 그대로 깨진다.
    target: ['es2020', 'safari14', 'chrome87'],
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
})
