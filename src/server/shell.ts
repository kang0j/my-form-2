import type { SurveyDef } from '../shared/schema'

/**
 * 공유 카드용 메타 태그를 서버에서 갈아 끼운다.
 *
 * 카카오톡 스크래퍼는 자바스크립트를 돌리지 않는다 — 링크를 채팅방에
 * 붙였을 때 보이는 카드는 이 앱이 SPA 로 나중에 바꾸는 제목이 아니라
 * 서버가 처음에 내려준 HTML 만 본다. 그래서 설문 링크(/s/:id)로 들어온
 * 요청에는 그 설문의 이름을 넣은 HTML 을 만들어 준다.
 *
 * 여기서 하는 일은 index.html 에 이미 있는 태그의 content 를 바꾸는 것뿐이다
 * — 태그를 새로 만들지 않으므로 기본값이 무엇인지는 index.html 한 곳에서만
 * 읽으면 된다.
 */
export type ShellMeta = {
  title: string
  description: string
  /** 이 페이지의 절대 URL. og:url 은 상대 경로를 받지 않는다. */
  url: string
}

const FALLBACK_DESCRIPTION = '이름과 답이 이어지지 않는 투표'

/**
 * 설문 하나를 공유 카드의 말로 옮긴다.
 *
 * 제목은 설문 이름 그대로다 — 링크를 받은 사람이 채팅방에서 제일 먼저
 * 보는 것이 "무슨 투표인가"여야 한다. 설명이 비어 있으면 이 앱이 무엇인지
 * 말하는 기본 문장으로 대신한다.
 *
 * 아직 열리지 않았거나 마감된 설문도 이름을 그대로 보여준다. 링크를 미리
 * 돌리고 나중에 여는 것이 정상 사용이라(§관리자), 그 사이 카드에 "설문을
 * 찾지 못했어요"가 뜨면 안 된다.
 */
export function surveyMeta(survey: SurveyDef, url: string): ShellMeta {
  return {
    title: survey.title,
    description: survey.description.trim() === '' ? FALLBACK_DESCRIPTION : survey.description,
    url,
  }
}

/** 메타 태그 하나를 찾아 content 를 바꾸는 HTMLRewriter 핸들러. */
function setContent(value: string) {
  return {
    element(element: { setAttribute(name: string, value: string): void }) {
      element.setAttribute('content', value)
    },
  }
}

/**
 * 첫 화면(`/`)의 공유 카드를 완성한다.
 *
 * 제목·설명은 index.html 에 적힌 사이트 기본값 그대로가 맞다 — 첫 화면은
 * 그 값이 말하는 바로 그 페이지다. 다만 og:url 만은 HTML 에 적어 둘 수
 * 없다: 절대 URL 이어야 하는데 배포 도메인은 코드가 아니라 wrangler.jsonc
 * 의 라우트에 있고, 상대 경로("/")를 그대로 두면 스크래퍼에 따라 카드
 * 자체를 만들지 않는다. 그래서 요청 주소를 보고 이 한 칸만 채운다.
 */
export function renderSiteShell(shell: Response, url: string): Response {
  return new HTMLRewriter()
    .on('meta[property="og:url"]', setContent(url))
    .transform(shell)
}

/**
 * index.html 응답에 메타를 얹어 새 응답으로 만든다.
 *
 * <title> 도 함께 바꾼다 — 스크래퍼가 og:title 을 못 읽는 경우의 마지막
 * 안전망이고, 사람이 링크를 열었을 때도 React 가 마운트되기 전 한 박자
 * 동안 설문 이름이 보인다.
 */
export function renderShell(shell: Response, meta: ShellMeta): Response {
  return new HTMLRewriter()
    .on('title', {
      element(element) {
        element.setInnerContent(meta.title)
      },
    })
    .on('meta[property="og:title"]', setContent(meta.title))
    .on('meta[property="og:description"]', setContent(meta.description))
    .on('meta[name="description"]', setContent(meta.description))
    .on('meta[property="og:url"]', setContent(meta.url))
    .transform(shell)
}
