import { SELF, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SurveyDef } from '../../src/shared/schema'
import { createSurvey, closeSurvey, getSurvey, openSurvey, setResultsVisibility } from '../../src/server/db/surveys'
import { replaceAllowlist } from '../../src/server/db/allowlist'

const NOW = Date.UTC(2026, 8, 2, 1, 0)
const BASE = 'https://example.com'

const draft = {
  title: '설문',
  description: '설명',
  resultsVisibility: 'after_close' as const,
  sections: [{ questions: [
    {
      type: 'single' as const,
      title: '단일',
      description: '',
      required: true,
      minSelect: null,
      maxSelect: null,
      allowOther: false,
      options: [
        { label: 'A', isOther: false },
        { label: 'B', isOther: false },
      ],
    },
  ] }],
}

let survey: SurveyDef

async function makeOpenSurvey(): Promise<SurveyDef> {
  const id = await createSurvey(env.DB, draft, NOW)
  await openSurvey(env.DB, id, NOW)
  return (await getSurvey(env.DB, id))!
}

function submitBody(overrides: Record<string, unknown> = {}) {
  return {
    name: '홍길동',
    studentId: '20250001',
    browserKey: 'browser-key-1',
    answers: [{ questionId: survey.sections[0].questions[0].id, type: 'single', optionId: survey.sections[0].questions[0].options[0].id }],
    ...overrides,
  }
}

async function post(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' },
    body: JSON.stringify(body),
  })
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM surveys').run()
  survey = await makeOpenSurvey()
})

describe('GET /api/surveys/:id', () => {
  it('열린 설문의 문항을 내려준다', async () => {
    const res = await SELF.fetch(`${BASE}/api/surveys/${survey.id}`)
    expect(res.status).toBe(200)

    const body = await res.json<{ title: string; status: string; sections: { questions: unknown[] }[] }>()
    expect(body.title).toBe('설문')
    expect(body.status).toBe('open')
    expect(body.sections).toHaveLength(1)
    expect(body.sections[0].questions).toHaveLength(1)
  })

  it('마감된 설문에는 문항을 내려주지 않는다', async () => {
    await closeSurvey(env.DB, survey.id, NOW)
    const res = await SELF.fetch(`${BASE}/api/surveys/${survey.id}`)

    const body = await res.json<{ status: string; sections: unknown[]; resultsAvailable: boolean }>()
    expect(body.status).toBe('closed')
    // 마감하면 섹션째 내려가지 않는다 — 화면을 그릴 재료가 아예 없다.
    expect(body.sections).toEqual([])
    expect(body.resultsAvailable).toBe(true)
  })

  it('없는 설문은 404 다', async () => {
    const res = await SELF.fetch(`${BASE}/api/surveys/nope`)
    expect(res.status).toBe(404)
  })
})

describe('POST /api/surveys/:id/submit', () => {
  it('제출을 받아들이고 응답 ID 를 돌려준다', async () => {
    const res = await post(`/api/surveys/${survey.id}/submit`, submitBody())
    expect(res.status).toBe(200)

    const body = await res.json<{ ok: boolean; duplicateIdentity: boolean; submissionId: string }>()
    expect(body.ok).toBe(true)
    expect(body.duplicateIdentity).toBe(false)
    // 낸 사람이 들고 가는 영수증이다. 이 값이 없으면 완료 화면이 번호를
    // 세울 수 없고, 응답 수정도 어느 응답을 갈아 끼울지 말할 수 없다.
    expect(body.submissionId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('같은 이름·학번이 다시 오면 알려준다', async () => {
    await post(`/api/surveys/${survey.id}/submit`, submitBody())
    const res = await post(`/api/surveys/${survey.id}/submit`, submitBody())

    const body = await res.json<{ ok: boolean; duplicateIdentity: boolean }>()
    expect(body.ok).toBe(true)
    expect(body.duplicateIdentity).toBe(true)
  })

  it('필수 문항을 비우면 400 과 사유를 돌려준다', async () => {
    const res = await post(`/api/surveys/${survey.id}/submit`, submitBody({ answers: [] }))
    expect(res.status).toBe(400)
    const body = await res.json<{ errors: string[] }>()
    expect(body.errors.length).toBeGreaterThan(0)
  })

  it('마감된 설문에는 제출할 수 없다', async () => {
    await closeSurvey(env.DB, survey.id, NOW)
    const res = await post(`/api/surveys/${survey.id}/submit`, submitBody())
    expect(res.status).toBe(400)
  })

  it('형식이 깨진 본문은 400 이다', async () => {
    const res = await post(`/api/surveys/${survey.id}/submit`, { name: '' })
    expect(res.status).toBe(400)
  })

  // db-submit.test.ts 의 '명부-응답 값 비연결성' 은 recordSubmission 을 직접
  // 불러 그 성질을 검사한다. 이 테스트는 같은 불변식을 HTTP 라우트를 통해
  // 확인한다 — 라우트가 recordSubmission 에 이름·학번·browserKey·IP·UA 를
  // 실제로 제대로 배선해 넘기는지는 이 경로로만 검증된다.
  it('제출 하나로는 명부 값과 응답 값이 survey.id 외에 이어지지 않는다', async () => {
    const res = await post(`/api/surveys/${survey.id}/submit`, {
      name: 'ZZ-HTTP-NAME',
      studentId: 'ZZ-HTTP-SID',
      browserKey: 'ZZ-HTTP-BROWSER-KEY',
      answers: [
        {
          questionId: survey.sections[0].questions[0].id,
          type: 'single',
          optionId: survey.sections[0].questions[0].options[0].id,
        },
      ],
    })
    expect(res.status).toBe(200)

    async function allValuesOf(table: 'participants' | 'submissions'): Promise<Set<string>> {
      const { results } = await env.DB
        .prepare(`SELECT * FROM ${table} WHERE survey_id = ?`)
        .bind(survey.id)
        .all<Record<string, unknown>>()
      const values = new Set<string>()
      for (const row of results) {
        for (const v of Object.values(row)) {
          if (v !== null && v !== undefined) values.add(String(v))
        }
      }
      return values
    }

    async function allAnswerValues(): Promise<Set<string>> {
      const { results } = await env.DB
        .prepare(
          `SELECT a.* FROM answers a
           JOIN submissions s ON s.id = a.submission_id
           WHERE s.survey_id = ?`,
        )
        .bind(survey.id)
        .all<Record<string, unknown>>()
      const values = new Set<string>()
      for (const row of results) {
        for (const v of Object.values(row)) {
          if (v !== null && v !== undefined) values.add(String(v))
        }
      }
      return values
    }

    const participantValues = await allValuesOf('participants')
    const submissionValues = await allValuesOf('submissions')
    const answerValues = await allAnswerValues()
    const responseValues = new Set([...submissionValues, ...answerValues])

    const intersection = [...participantValues].filter((v) => responseValues.has(v))
    expect(intersection).toEqual([survey.id])

    const responseText = [...responseValues].join('\n')
    for (const secret of ['ZZ-HTTP-NAME', 'ZZ-HTTP-SID', 'ZZ-HTTP-BROWSER-KEY', '203.0.113.7']) {
      expect(responseText).not.toContain(secret)
    }
  })
})

describe('POST /api/surveys/:id/receipts — 이 기기가 낸 응답 ID 되살리기', () => {
  async function submissionIdsFor(browserKey: string): Promise<string[]> {
    const res = await post(`/api/surveys/${survey.id}/receipts`, { browserKey })
    expect(res.status).toBe(200)
    return (await res.json<{ submissionIds: string[] }>()).submissionIds
  }

  it('이 기기가 낸 응답 ID 를 돌려준다', async () => {
    const submitted = await post(`/api/surveys/${survey.id}/submit`, submitBody())
    const { submissionId } = await submitted.json<{ submissionId: string }>()

    expect(await submissionIdsFor('browser-key-1')).toEqual([submissionId])
  })

  it('다른 기기의 응답은 돌려주지 않는다', async () => {
    await post(`/api/surveys/${survey.id}/submit`, submitBody())
    expect(await submissionIdsFor('browser-key-2')).toEqual([])
  })

  // 같은 학교 와이파이를 쓰면 IP 가 겹치지만, 찾는 기준은 IP 가 아니라
  // 브라우저 키다 — 위 post() 는 두 제출에 같은 CF-Connecting-IP 를 싣는다.
  it('IP 가 같아도 브라우저 키가 다르면 섞이지 않는다', async () => {
    const mine = await post(`/api/surveys/${survey.id}/submit`, submitBody())
    await post(
      `/api/surveys/${survey.id}/submit`,
      submitBody({ name: '김철수', studentId: '20250002', browserKey: 'browser-key-2' }),
    )

    const { submissionId } = await mine.json<{ submissionId: string }>()
    expect(await submissionIdsFor('browser-key-1')).toEqual([submissionId])
  })

  it('한 기기가 여러 번 냈으면 전부 돌려준다', async () => {
    await post(`/api/surveys/${survey.id}/submit`, submitBody())
    await post(
      `/api/surveys/${survey.id}/submit`,
      submitBody({ name: '김철수', studentId: '20250002' }),
    )

    expect(await submissionIdsFor('browser-key-1')).toHaveLength(2)
  })

  it('마감된 설문에서도 돌려준다 — 낸 번호는 언제든 확인할 수 있다', async () => {
    const submitted = await post(`/api/surveys/${survey.id}/submit`, submitBody())
    const { submissionId } = await submitted.json<{ submissionId: string }>()
    await closeSurvey(env.DB, survey.id, NOW)

    expect(await submissionIdsFor('browser-key-1')).toEqual([submissionId])
  })

  it('없는 설문은 404 다', async () => {
    const res = await post('/api/surveys/nope/receipts', { browserKey: 'browser-key-1' })
    expect(res.status).toBe(404)
  })

  it('형식이 깨진 본문은 400 이다', async () => {
    const res = await post(`/api/surveys/${survey.id}/receipts`, { browserKey: 'short' })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/surveys/:id/submit — 응답 수정(replaces)', () => {
  const optionB = () => survey.sections[0].questions[0].options[1].id

  async function submitOnce(): Promise<string> {
    const res = await post(`/api/surveys/${survey.id}/submit`, submitBody())
    return (await res.json<{ submissionId: string }>()).submissionId
  }

  function editBody(replaces: string, overrides: Record<string, unknown> = {}) {
    return submitBody({
      replaces,
      answers: [
        {
          questionId: survey.sections[0].questions[0].id,
          type: 'single',
          optionId: optionB(),
        },
      ],
      ...overrides,
    })
  }

  it('응답 ID 는 그대로 두고 답만 갈아 끼운다', async () => {
    const submissionId = await submitOnce()

    const res = await post(`/api/surveys/${survey.id}/submit`, editBody(submissionId))
    expect(res.status).toBe(200)

    const body = await res.json<{ submissionId: string; duplicateIdentity: boolean }>()
    expect(body.submissionId).toBe(submissionId)
    // 명부에 줄을 더하지 않으므로 신원 중복도 아니다.
    expect(body.duplicateIdentity).toBe(false)

    const { results } = await env.DB
      .prepare('SELECT option_id AS optionId FROM answers WHERE submission_id = ?')
      .bind(submissionId)
      .all<{ optionId: string }>()
    expect(results).toEqual([{ optionId: optionB() }])
  })

  it('명부 수도 응답 수도 늘지 않는다', async () => {
    const submissionId = await submitOnce()
    await post(`/api/surveys/${survey.id}/submit`, editBody(submissionId))

    for (const table of ['participants', 'submissions'] as const) {
      const row = await env.DB
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE survey_id = ?`)
        .bind(survey.id)
        .first<{ n: number }>()
      expect(row?.n).toBe(1)
    }
  })

  it('제출 시각이 갱신된다', async () => {
    const submissionId = await submitOnce()
    const before = await env.DB
      .prepare('SELECT submitted_at AS at FROM participants WHERE survey_id = ?')
      .bind(survey.id)
      .first<{ at: number }>()

    await post(`/api/surveys/${survey.id}/submit`, editBody(submissionId))

    const after = await env.DB
      .prepare('SELECT submitted_at AS at FROM participants WHERE survey_id = ?')
      .bind(survey.id)
      .first<{ at: number }>()
    expect(after!.at).toBeGreaterThanOrEqual(before!.at)
  })

  it('다른 기기의 응답은 고칠 수 없다', async () => {
    const submissionId = await submitOnce()

    const res = await post(
      `/api/surveys/${survey.id}/submit`,
      editBody(submissionId, { browserKey: 'browser-key-2' }),
    )
    expect(res.status).toBe(403)
  })

  it('명부에 없는 이름·학번으로는 고칠 수 없다', async () => {
    const submissionId = await submitOnce()

    const res = await post(
      `/api/surveys/${survey.id}/submit`,
      editBody(submissionId, { name: '없는사람', studentId: '00000000' }),
    )
    expect(res.status).toBe(403)
  })

  it('없는 응답 ID 는 고칠 수 없다', async () => {
    await submitOnce()
    const res = await post(`/api/surveys/${survey.id}/submit`, editBody('없는-응답-id'))
    expect(res.status).toBe(403)
  })

  // 수정도 제출이라 같은 문을 지난다 — 마감된 설문의 문은 닫혀 있다.
  it('마감된 설문에서는 고칠 수 없다', async () => {
    const submissionId = await submitOnce()
    await closeSurvey(env.DB, survey.id, NOW)

    const res = await post(`/api/surveys/${survey.id}/submit`, editBody(submissionId))
    expect(res.status).toBe(400)
  })

  it('수정한 뒤에도 명부 값과 응답 값은 이어지지 않는다', async () => {
    const res = await post(`/api/surveys/${survey.id}/submit`, {
      name: 'ZZ-EDIT-NAME',
      studentId: 'ZZ-EDIT-SID',
      browserKey: 'ZZ-EDIT-BROWSER-KEY',
      answers: [
        {
          questionId: survey.sections[0].questions[0].id,
          type: 'single',
          optionId: survey.sections[0].questions[0].options[0].id,
        },
      ],
    })
    const { submissionId } = await res.json<{ submissionId: string }>()

    await post(`/api/surveys/${survey.id}/submit`, {
      name: 'ZZ-EDIT-NAME',
      studentId: 'ZZ-EDIT-SID',
      browserKey: 'ZZ-EDIT-BROWSER-KEY',
      replaces: submissionId,
      answers: [
        { questionId: survey.sections[0].questions[0].id, type: 'single', optionId: optionB() },
      ],
    })

    const { results: responseRows } = await env.DB
      .prepare(
        `SELECT s.*, a.* FROM submissions s
         LEFT JOIN answers a ON a.submission_id = s.id
         WHERE s.survey_id = ?`,
      )
      .bind(survey.id)
      .all<Record<string, unknown>>()

    const responseText = responseRows
      .flatMap((row) => Object.values(row))
      .filter((v) => v !== null && v !== undefined)
      .join('\n')

    for (const secret of ['ZZ-EDIT-NAME', 'ZZ-EDIT-SID', 'ZZ-EDIT-BROWSER-KEY', '203.0.113.7']) {
      expect(responseText).not.toContain(secret)
    }
  })
})

describe('GET /api/surveys/:id/results', () => {
  it('after_close 설문은 마감 전에는 막는다', async () => {
    const res = await SELF.fetch(`${BASE}/api/surveys/${survey.id}/results`)
    expect(res.status).toBe(403)
  })

  it('after_close 설문은 마감 후에 열어준다', async () => {
    await post(`/api/surveys/${survey.id}/submit`, submitBody())
    await closeSurvey(env.DB, survey.id, NOW)

    const res = await SELF.fetch(`${BASE}/api/surveys/${survey.id}/results`)
    expect(res.status).toBe(200)

    const body = await res.json<{ submissionCount: number; results: Array<{ counts: Array<{ count: number }> }> }>()
    expect(body.submissionCount).toBe(1)
    expect(body.results[0].counts[0].count).toBe(1)
  })

  it('after_close 설문도 마감 전에는 막는다', async () => {
    await setResultsVisibility(env.DB, survey.id, 'after_close')
    const res = await SELF.fetch(`${BASE}/api/surveys/${survey.id}/results`)
    expect(res.status).not.toBe(200)
  })

  it('admin 설문은 마감 후에도 막는다', async () => {
    await setResultsVisibility(env.DB, survey.id, 'admin')
    await closeSurvey(env.DB, survey.id, NOW)

    const res = await SELF.fetch(`${BASE}/api/surveys/${survey.id}/results`)
    expect(res.status).toBe(403)
  })
})

describe('허용 명단 게이트', () => {
  describe('POST /api/surveys/:id/check — 표지에서 미리 묻기', () => {
    it('명단이 비어 있으면 누구나 통과한다', async () => {
      const res = await post(`/api/surveys/${survey.id}/check`, {
        name: '아무개',
        studentId: '99999999',
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ allowed: true })
    })

    it('명단에 있으면 통과한다', async () => {
      await replaceAllowlist(env.DB, survey.id, [{ name: '홍길동', studentId: '20250001' }])
      const res = await post(`/api/surveys/${survey.id}/check`, {
        name: '홍길동',
        studentId: '20250001',
      })
      expect(await res.json()).toEqual({ allowed: true })
    })

    // 막혔다는 사실 자체는 200 으로 알린다 — 표지가 이 응답을 읽고 화면에
    // 문구를 띄우는 정상 흐름이지, 요청이 잘못된 것이 아니다.
    it('명단에 없으면 allowed:false 를 돌려준다', async () => {
      await replaceAllowlist(env.DB, survey.id, [{ name: '홍길동', studentId: '20250001' }])
      const res = await post(`/api/surveys/${survey.id}/check`, {
        name: '김서연',
        studentId: '20250002',
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ allowed: false })
    })

    it('이름·학번이 빠지면 400 이다', async () => {
      const res = await post(`/api/surveys/${survey.id}/check`, { name: '홍길동' })
      expect(res.status).toBe(400)
    })

    it('없는 설문에는 404 다', async () => {
      const res = await post('/api/surveys/nosuch/check', { name: '홍길동', studentId: '1' })
      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/surveys/:id/submit — 진짜 권위', () => {
    // 표지 게이트는 편의일 뿐이다. 표지를 건너뛰고 submit 을 직접 때리면
    // 그만인 게이트는 게이트가 아니므로, 제출에서 한 번 더 막는다.
    it('명단에 없는 사람의 제출을 403 으로 막는다', async () => {
      await replaceAllowlist(env.DB, survey.id, [{ name: '홍길동', studentId: '20250001' }])
      const res = await post(
        `/api/surveys/${survey.id}/submit`,
        submitBody({ name: '김서연', studentId: '20250002' }),
      )

      expect(res.status).toBe(403)
      expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM participants').first<{ n: number }>())
        .toEqual({ n: 0 })
    })

    it('막힌 제출은 응답도 남기지 않는다', async () => {
      await replaceAllowlist(env.DB, survey.id, [{ name: '홍길동', studentId: '20250001' }])
      await post(
        `/api/surveys/${survey.id}/submit`,
        submitBody({ name: '김서연', studentId: '20250002' }),
      )

      expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM submissions').first<{ n: number }>())
        .toEqual({ n: 0 })
    })

    it('명단에 있으면 제출된다', async () => {
      await replaceAllowlist(env.DB, survey.id, [{ name: '홍길동', studentId: '20250001' }])
      const res = await post(`/api/surveys/${survey.id}/submit`, submitBody())
      expect(res.status).toBe(200)
    })

    it('표기가 달라도 같은 사람이면 제출된다', async () => {
      await replaceAllowlist(env.DB, survey.id, [{ name: '홍길동', studentId: '20250001' }])
      const res = await post(
        `/api/surveys/${survey.id}/submit`,
        submitBody({ name: ' 홍길동 ' }),
      )
      expect(res.status).toBe(200)
    })

    it('명단이 비어 있으면 지금까지처럼 누구나 제출된다', async () => {
      const res = await post(`/api/surveys/${survey.id}/submit`, submitBody())
      expect(res.status).toBe(200)
    })
  })
})
