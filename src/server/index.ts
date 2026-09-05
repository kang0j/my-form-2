import { Hono } from 'hono'
import { publicRoutes } from './routes/public'
import { adminRoutes } from './routes/admin'
import { getSurvey, SurveyNotFoundError, SurveyStateError } from './db/surveys'
import { renderShell, renderSiteShell, surveyMeta } from './shell'

/**
 * 정적 자산 바인딩. wrangler.jsonc 의 assets.binding 에서 온다 — 설문
 * 링크로 들어온 요청에 index.html 을 직접 집어 들어 공유 카드용 메타를
 * 갈아 끼우기 위해서다(§shell.ts).
 */
type ShellEnv = Env & { ASSETS: Fetcher }

const app = new Hono<{ Bindings: ShellEnv }>()

app.route('/api', publicRoutes)
app.route('/api/admin', adminRoutes)

/**
 * 첫 화면. 카카오톡 채팅방에 도메인만 붙이는 일이 실제로 있고(설문 링크가
 * 아니라 "이거 뭐야" 하고 주소를 넘기는 경우), 그때 뜨는 카드의 og:url 이
 * 상대 경로면 스크래퍼가 카드를 만들지 않는다. 자산을 그대로 내보내되 그
 * 한 칸만 절대 주소로 채운다 — 제목·설명은 index.html 의 사이트 기본값이
 * 이미 이 화면을 정확히 말하고 있다.
 */
app.get('/', async (c) => {
  const url = new URL(c.req.url)
  const shell = await c.env.ASSETS.fetch(new Request(new URL('/', url), c.req.raw))
  if (!shell.ok) return shell
  return renderSiteShell(shell, url.toString())
})

/**
 * 설문 링크로 들어온 HTML 요청.
 *
 * `/s/*` 전체를 Worker 가 먼저 받는다(wrangler.jsonc §run_worker_first).
 * 투표 화면(`/s/:id`)뿐 아니라 공개 결과(`/s/:id/results`)까지 한 핸들러로
 * 받는 이유는, 앞의 것만 잡아 두면 나머지 경로가 Hono 의 404 JSON 으로
 * 떨어져 화면 자체가 뜨지 않기 때문이다.
 *
 * 나머지 화면(관리자 등)은 자산이 그대로 나가고, 공유 카드에는 index.html
 * 의 사이트 기본값이 쓰인다 — 그 링크를 채팅방에 붙이는 일은 없다.
 */
app.get('/s/*', async (c) => {
  const url = new URL(c.req.url)
  // '/index.html' 이 아니라 '/' 를 집는다. 정적 자산 서버는 '/index.html' 을
  // 정규 URL 인 '/' 로 307 리다이렉트하는데, 그 응답은 ok 가 아니라서 아래
  // 분기가 그대로 밖으로 내보낸다 — 설문 링크가 전부 홈으로 튕긴다.
  const shell = await c.env.ASSETS.fetch(new Request(new URL('/', url), c.req.raw))

  // 자산을 못 집어 들면(있을 수 없지만) 그대로 내보낸다 — 공유 카드가
  // 예쁘지 않은 것보다 화면이 안 뜨는 쪽이 훨씬 나쁘다.
  if (!shell.ok) return shell

  const surveyId = url.pathname.split('/')[2] ?? ''
  if (surveyId === '') return shell

  // 설문을 못 읽어도 화면은 떠야 한다. 이 요청의 본체는 앱 껍데기이고 설문
  // 조회는 공유 카드를 예쁘게 하려는 곁가지다 — 그런데 예외를 그냥 던지면
  // app.onError 가 JSON 오류를 내보내고(§onError), 링크를 연 사람은 앱
  // 대신 흰 화면에 적힌 영문 JSON 을 본다. DB 가 잠깐 흔들리는 것과 앱이
  // 아예 안 뜨는 것은 무게가 다르다.
  const survey = await getSurvey(c.env.DB, surveyId).catch(() => null)
  if (!survey) return shell

  return renderShell(shell, surveyMeta(survey, url.toString()))
})

app.onError((error, c) => {
  if (error instanceof SurveyNotFoundError) return c.json({ error: error.message }, 404)
  if (error instanceof SurveyStateError) return c.json({ error: error.message }, 409)
  console.error(error.message, error.stack)
  return c.json({ error: '서버에 문제가 생겼어요.' }, 500)
})

export default app
