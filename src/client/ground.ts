import { useEffect } from 'react'

/**
 * 두 세계의 바탕색. --ground / --paper 와 같은 값이며, 여기서는 CSS 가
 * 칠하지 못하는 곳 — 문서 캔버스(html/body)와 브라우저 크롬
 * (<meta name="theme-color">) — 을 맞추는 데만 쓴다.
 */
export const GROUND_HEX = '#0a0a0a'
export const PAPER_HEX = '#f5f2e8'

/**
 * 검정 세계에 사는 화면(투표 흐름, 첫 화면)의 문서 캔버스와 브라우저 크롬을
 * 같은 검정으로 물들인다 — 안 그러면 러버밴드 오버스크롤의 여백이나 인앱
 * 브라우저 주소창이 여전히 종이색을 비춘다. index.html 의 인라인 스크립트가
 * 첫 페인트를 맡고, 이 훅이 React 마운트 이후를 이어받는다. 화면을 벗어나면
 * (결과·관리자로 라우팅) 종이 기본값으로 되돌린다.
 *
 * 투표 흐름과 첫 화면이 같은 훅을 쓴다 — 바탕을 칠하는 방법이 두 벌이 되면
 * 한쪽만 고쳐지는 날이 온다.
 */
export function useVoteWorldGround(): void {
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    document.documentElement.style.backgroundColor = GROUND_HEX
    document.body.style.backgroundColor = GROUND_HEX
    meta?.setAttribute('content', GROUND_HEX)
    return () => {
      document.documentElement.style.backgroundColor = ''
      document.body.style.backgroundColor = ''
      meta?.setAttribute('content', PAPER_HEX)
    }
  }, [])
}
