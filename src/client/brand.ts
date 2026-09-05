import { useEffect } from 'react'

/**
 * 사이트 이름은 여기 한 곳에서만 정한다 — 화면의 h1, 문서 제목,
 * index.html 의 기본 <title> 이 서로 어긋나면 같은 서비스가 두 이름으로
 * 보인다.
 */
export const SITE_NAME = 'AN-FORM'

/** 문서 제목(탭 이름)에 쓰는 전체 이름. 화면 안 h1 은 SITE_NAME 만 쓴다. */
export const SITE_TITLE = `${SITE_NAME} | JAEHYUN.DEV`

/**
 * 설문 하나를 다루는 화면(투표·공개 결과·관리자 상세)의 문서 제목을 그
 * 설문 이름으로 바꾼다. 관리자가 여러 설문 링크를 동시에 열어두는 것이
 * 이 앱의 기본 사용법인데, 탭이 전부 같은 이름이면 어느 탭이 어느 설문인지
 * 탭 목록에서 구분되지 않는다.
 *
 * title 이 아직 없으면(로딩 중·오류) 건드리지 않는다 — 빈 제목이 잠깐
 * 스치는 것보다 기본 제목이 남아 있는 편이 낫다. 화면을 벗어나면 기본
 * 제목으로 되돌린다.
 */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!title) return
    document.title = title
    return () => {
      document.title = SITE_TITLE
    }
  }, [title])
}
