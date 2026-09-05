import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { SurveyDef } from '../../src/shared/schema'
import { renderShell, surveyMeta } from '../../src/server/shell'

/** index.html 에서 이 시험에 필요한 부분만 옮겨 온 껍데기. */
const SHELL = `<!doctype html>
<html lang="ko">
  <head>
    <title>AN-FORM | JAEHYUN.DEV</title>
    <meta property="og:title" content="AN-FORM" />
    <meta property="og:description" content="이름과 답이 이어지지 않는 투표" />
    <meta property="og:url" content="/" />
    <meta name="description" content="이름과 답이 이어지지 않는 투표" />
  </head>
  <body><div id="root"></div></body>
</html>`

const survey: SurveyDef = {
  id: 'abc123',
  title: '감염치료약학 시간 변경 조사',
  description: '',
  status: 'open',
  resultsVisibility: 'after_close',
  closeAt: null,
  sections: [],
}

async function render(def: SurveyDef): Promise<string> {
  const shell = new Response(SHELL, { headers: { 'Content-Type': 'text/html' } })
  const meta = surveyMeta(def, 'https://form.example/s/abc123')
  return renderShell(shell, meta).text()
}

describe('surveyMeta', () => {
  it('설문 이름을 제목으로 쓴다', () => {
    expect(surveyMeta(survey, 'u').title).toBe('감염치료약학 시간 변경 조사')
  })

  it('설명이 비어 있으면 이 앱이 무엇인지 말하는 기본 문장을 쓴다', () => {
    expect(surveyMeta(survey, 'u').description).toBe('이름과 답이 이어지지 않는 투표')
  })

  it('공백뿐인 설명도 비어 있는 것으로 본다', () => {
    expect(surveyMeta({ ...survey, description: '   ' }, 'u').description).toBe(
      '이름과 답이 이어지지 않는 투표',
    )
  })

  it('설명이 있으면 그대로 쓴다', () => {
    expect(surveyMeta({ ...survey, description: '조건부 문항 확인용' }, 'u').description).toBe(
      '조건부 문항 확인용',
    )
  })

  // 링크를 먼저 돌리고 나중에 여는 것이 정상 사용이다 — 그 사이 카드에
  // 「설문을 찾지 못했어요」가 뜨면 안 된다.
  it('아직 열리지 않았거나 마감된 설문도 이름을 그대로 보여준다', () => {
    expect(surveyMeta({ ...survey, status: 'draft' }, 'u').title).toBe(survey.title)
    expect(surveyMeta({ ...survey, status: 'closed' }, 'u').title).toBe(survey.title)
  })
})

describe('renderShell', () => {
  it('og:title 을 설문 이름으로 바꾼다', async () => {
    const html = await render(survey)
    expect(html).toContain('<meta property="og:title" content="감염치료약학 시간 변경 조사" />')
  })

  it('og:url 을 절대 URL 로 채운다', async () => {
    const html = await render(survey)
    expect(html).toContain('content="https://form.example/s/abc123"')
  })

  // 카드에 그림은 두지 않는다 — 이 저장소는 이미지 자산을 쓰지 않는다.
  it('og:image 를 만들어 넣지 않는다', async () => {
    const html = await render(survey)
    expect(html).not.toContain('og:image')
  })

  it('<title> 도 함께 바꾼다', async () => {
    const html = await render(survey)
    expect(html).toContain('<title>감염치료약학 시간 변경 조사</title>')
  })

  it('og:description 과 name=description 이 같은 말을 한다', async () => {
    const html = await render({ ...survey, description: '조건부 문항 확인용' })
    expect(html).toContain('<meta property="og:description" content="조건부 문항 확인용" />')
    expect(html).toContain('<meta name="description" content="조건부 문항 확인용" />')
  })

  it('제목에 든 따옴표·꺾쇠가 태그를 깨뜨리지 않는다', async () => {
    const html = await render({ ...survey, title: '"따옴표" & <꺾쇠>' })

    expect(html).toContain('&quot;')
    expect(html).not.toContain('content=""따옴표"')
    // 제목 안의 <꺾쇠> 가 새 태그로 파싱되지 않았다면 head 구조가 그대로다.
    expect(html).toContain('<div id="root">')
  })

  it('본문은 건드리지 않는다 — 앱은 그대로 뜬다', async () => {
    const html = await render(survey)
    expect(html).toContain('<div id="root"></div>')
  })
})

/**
 * 라우트 배선 회귀 — 설문 링크가 홈으로 튕기던 버그.
 *
 * `/s/*` 핸들러는 껍데기를 ASSETS 에서 집어 와 공유 메타를 갈아 끼운다.
 * 그 때 '/index.html' 을 집으면 정적 자산 서버가 정규 URL 인 '/' 로 307
 * 리다이렉트를 돌려주는데, 그 응답은 ok 가 아니라서 핸들러가 그대로 밖으로
 * 내보낸다 — 카카오톡으로 받은 설문 링크가 전부 홈 화면으로 튕겼다.
 * surveyMeta·renderShell 단위 시험은 전부 통과한 채였다. 깨진 것은 껍데기를
 * 집어 오는 한 줄이었기 때문이다.
 */
describe('/s/* 껍데기 배선', () => {
  it('설문 링크는 리다이렉트가 아니라 화면을 낸다', async () => {
    const res = await SELF.fetch('https://example.com/s/abc123', { redirect: 'manual' })
    expect(res.status).toBe(200)
    expect(res.headers.get('Location')).toBeNull()
  })

  it('없는 설문이어도 화면은 뜬다', async () => {
    const res = await SELF.fetch('https://example.com/s/nope', { redirect: 'manual' })
    expect(res.status).toBe(200)
  })

  // 설문 조회는 공유 카드를 예쁘게 하려는 곁가지다. 그 조회가 실패했다고
  // 앱 껍데기까지 JSON 오류로 바뀌면(app.onError), 링크를 연 사람은 투표를
  // 시작할 수조차 없다. DB 를 실제로 망가뜨려 그 경로를 밟는다 — 시험마다
  // 저장소가 격리되므로 이 파괴는 이 시험 안에서 끝난다.
  it('설문 조회가 실패해도 화면은 뜬다', async () => {
    await env.DB.prepare('DROP TABLE surveys').run()

    const res = await SELF.fetch('https://example.com/s/abc123', { redirect: 'manual' })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/html')
  })
})
