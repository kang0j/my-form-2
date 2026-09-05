import { SELF, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { adminRoutes } from '../../src/server/routes/admin'

const BASE = 'https://example.com'

const draft = {
  title: '설문',
  description: '설명',
  resultsVisibility: 'after_close',
  sections: [{ questions: [
    {
      type: 'single',
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

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`${BASE}/api/admin${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
}

async function createDraft(): Promise<string> {
  const res = await api('/surveys', { method: 'POST', body: JSON.stringify(draft) })
  const body = await res.json<{ id: string }>()
  return body.id
}

/** 결과·응답 CSV 는 마감된 설문에서만 열린다(§requireClosedForResults). */
async function createClosed(): Promise<string> {
  const id = await createDraft()
  await api(`/surveys/${id}/open`, { method: 'POST' })
  await api(`/surveys/${id}/close`, { method: 'POST' })
  return id
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM surveys').run()
})

describe('설문 CRUD', () => {
  it('설문을 만들고 목록에서 볼 수 있다', async () => {
    const id = await createDraft()

    const res = await api('/surveys')
    const list = await res.json<Array<{ id: string; participantCount: number }>>()
    expect(list.map((s) => s.id)).toContain(id)
    expect(list[0].participantCount).toBe(0)
  })

  it('잘못된 설문 정의를 거부한다', async () => {
    const res = await api('/surveys', {
      method: 'POST',
      body: JSON.stringify({ ...draft, title: '' }),
    })
    expect(res.status).toBe(400)
  })

  it('뒤 문항을 가리키는 조건은 400 으로 거부한다', async () => {
    const body = {
      title: '조건 설문',
      description: '',
      resultsVisibility: 'after_close',
      sections: [
        {
          questions: [
            {
              type: 'single',
              title: '1번',
              description: '',
              required: false,
              minSelect: null,
              maxSelect: null,
              allowOther: false,
              options: [{ label: '예', isOther: false }],
              rules: [
                {
                  match: 'all',
                  action: 'show',
                  targets: [{ kind: 'question', questionIndex: 0 }],
                  conditions: [{ operator: 'is', optionIndex: 0 }],
                },
              ],
            },
          ],
        },
      ],
    }

    const res = await api('/surveys', { method: 'POST', body: JSON.stringify(body) })
    expect(res.status).toBe(400)
  })

  it('설문 하나를 문항까지 내려준다', async () => {
    const id = await createDraft()
    const res = await api(`/surveys/${id}`)
    const body = await res.json<{ sections: { questions: unknown[] }[] }>()
    expect(body.sections).toHaveLength(1)
    expect(body.sections[0].questions).toHaveLength(1)
  })

  it('draft 문항을 교체한다', async () => {
    const id = await createDraft()
    const res = await api(`/surveys/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...draft, title: '바뀐 제목' }),
    })
    expect(res.status).toBe(200)

    const after = await (await api(`/surveys/${id}`)).json<{ title: string }>()
    expect(after.title).toBe('바뀐 제목')
  })
})

describe('운영', () => {
  it('열고 닫을 수 있다', async () => {
    const id = await createDraft()
    expect((await api(`/surveys/${id}/open`, { method: 'POST' })).status).toBe(200)
    expect((await api(`/surveys/${id}/close`, { method: 'POST' })).status).toBe(200)
  })

  it('마감한 설문을 다시 열 수 있고, 열려 있는 설문 재개는 409 로 막는다', async () => {
    const id = await createDraft()
    await api(`/surveys/${id}/open`, { method: 'POST' })
    await api(`/surveys/${id}/close`, { method: 'POST' })

    expect((await api(`/surveys/${id}/reopen`, { method: 'POST' })).status).toBe(200)
    expect((await api(`/surveys/${id}`, { method: 'GET' })).status).toBe(200)
    expect((await api(`/surveys/${id}/reopen`, { method: 'POST' })).status).toBe(409)
  })

  it('열린 설문 문항 수정은 409 로 막는다', async () => {
    const id = await createDraft()
    await api(`/surveys/${id}/open`, { method: 'POST' })

    const res = await api(`/surveys/${id}`, { method: 'PUT', body: JSON.stringify(draft) })
    expect(res.status).toBe(409)
  })

  it('결과 공개 설정을 바꾼다', async () => {
    const id = await createDraft()
    const res = await api(`/surveys/${id}/visibility`, {
      method: 'POST',
      body: JSON.stringify({ resultsVisibility: 'after_close' }),
    })
    expect(res.status).toBe(200)

    const after = await (await api(`/surveys/${id}`)).json<{ resultsVisibility: string }>()
    expect(after.resultsVisibility).toBe('after_close')
  })

  it('모르는 공개 설정을 거부한다', async () => {
    const id = await createDraft()
    const res = await api(`/surveys/${id}/visibility`, {
      method: 'POST',
      body: JSON.stringify({ resultsVisibility: 'everyone' }),
    })
    expect(res.status).toBe(400)
  })

  it('설문을 복제한다', async () => {
    const id = await createDraft()
    const res = await api(`/surveys/${id}/duplicate`, { method: 'POST' })
    const body = await res.json<{ id: string }>()
    expect(body.id).not.toBe(id)

    const copy = await (await api(`/surveys/${body.id}`)).json<{ title: string; status: string }>()
    expect(copy.title).toBe('설문 (사본)')
    expect(copy.status).toBe('draft')
  })
})

describe('결과와 점검', () => {
  it('마감한 뒤에는 공개 설정과 무관하게 관리자가 결과를 본다', async () => {
    const id = await createClosed()
    await api(`/surveys/${id}/visibility`, {
      method: 'POST',
      body: JSON.stringify({ resultsVisibility: 'admin' }),
    })

    const res = await api(`/surveys/${id}/results`)
    expect(res.status).toBe(200)
    const body = await res.json<{ results: unknown[] }>()
    expect(body.results).toHaveLength(1)
  })

  // 진행 중에 집계를 두 번 읽으면 그 차이가 그 사이 들어온 한 표다. 참가자
  // 화면이 그 표에 이름을 붙이므로, 관리자에게도 마감 전에는 주지 않는다.
  it('마감 전에는 관리자에게도 결과를 주지 않는다', async () => {
    const id = await createDraft()
    await api(`/surveys/${id}/open`, { method: 'POST' })

    const res = await api(`/surveys/${id}/results`)
    expect(res.status).toBe(409)
  })

  it('draft 설문의 결과도 막는다', async () => {
    const id = await createDraft()
    expect((await api(`/surveys/${id}/results`)).status).toBe(409)
  })

  it('점검 보고서를 돌려준다', async () => {
    const id = await createDraft()
    const res = await api(`/surveys/${id}/audit`)
    expect(res.status).toBe(200)

    const body = await res.json<{ integrity: { consistent: boolean } }>()
    expect(body.integrity.consistent).toBe(true)
  })
})

describe('CSV 내보내기', () => {
  it('응답 CSV 를 내려준다', async () => {
    const id = await createClosed()
    const res = await api(`/surveys/${id}/export?type=responses`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/csv')
    expect(await res.text()).toContain('응답 ID')
  })

  // 응답 CSV 는 집계보다 더 날것이라 같은 잠금을 건다 — 집계만 막고 이쪽을
  // 열어 두면 델타 공격이 CSV 로 그대로 넘어간다.
  it('마감 전에는 응답 CSV 도 막는다', async () => {
    const id = await createDraft()
    await api(`/surveys/${id}/open`, { method: 'POST' })
    expect((await api(`/surveys/${id}/export?type=responses`)).status).toBe(409)
  })

  it('명부 CSV 를 내려준다', async () => {
    const id = await createDraft()
    const res = await api(`/surveys/${id}/export?type=roster`)
    expect(await res.text()).toContain('이름,학번')
  })

  it('모르는 종류는 400 이다', async () => {
    const id = await createDraft()
    expect((await api(`/surveys/${id}/export?type=secret`)).status).toBe(400)
  })
})

describe('없는 설문', () => {
  it('404 를 낸다', async () => {
    expect((await api('/surveys/nope')).status).toBe(404)
    expect((await api('/surveys/nope/audit')).status).toBe(404)
  })

  it('쓰기 라우트도 409 가 아니라 404 를 낸다', async () => {
    expect(
      (await api('/surveys/nope', { method: 'PUT', body: JSON.stringify(draft) })).status,
    ).toBe(404)
    expect((await api('/surveys/nope/open', { method: 'POST' })).status).toBe(404)
    expect((await api('/surveys/nope/close', { method: 'POST' })).status).toBe(404)
    expect((await api('/surveys/nope/reopen', { method: 'POST' })).status).toBe(404)
    expect((await api('/surveys/nope/duplicate', { method: 'POST' })).status).toBe(404)
  })

  it('결과 공개 설정 변경도 없는 설문이면 404 를 낸다', async () => {
    const res = await api('/surveys/nope/visibility', {
      method: 'POST',
      body: JSON.stringify({ resultsVisibility: 'after_close' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('관리자 인증 배선', () => {
  it('ADMIN_AUTH_MODE 없이 adminRoutes 를 직접 호출하면 500 이다', async () => {
    // adminRoutes.use('*', requireAdmin) 을 지워도 이 파일의 다른 테스트는 전부 통과한다
    // (SELF.fetch 는 .dev.vars 의 insecure-local 설정을 얹기 때문이다). 이 테스트만이
    // 라우트 배선 자체를 검사한다.
    const res = await adminRoutes.request('/surveys', {}, { DB: env.DB })
    expect(res.status).toBe(500)
  })
})

describe('공개 API 에는 관리자 전용 경로가 없다', () => {
  it('/api/surveys/:id/audit 는 없다', async () => {
    const res = await SELF.fetch(`${BASE}/api/surveys/nope/audit`)
    expect(res.status).toBe(404)
  })

  it('/api/surveys/:id/export 는 없다', async () => {
    const res = await SELF.fetch(`${BASE}/api/surveys/nope/export`)
    expect(res.status).toBe(404)
  })
})

describe('허용 명단 관리', () => {
  async function addParticipant(surveyId: string, name: string, studentId: string): Promise<void> {
    await env.DB.prepare(
      `INSERT INTO participants (id, survey_id, name, student_id, submitted_at, ip_hash, ua_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), surveyId, name, studentId, Date.now(), 'ip', 'ua')
      .run()
  }

  it('처음에는 명단이 비어 있다', async () => {
    const id = await createDraft()
    const res = await api(`/surveys/${id}/allowlist`)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ entries: [] })
  })

  it('명단을 저장하고 다시 읽을 수 있다', async () => {
    const id = await createDraft()
    const put = await api(`/surveys/${id}/allowlist`, {
      method: 'PUT',
      body: JSON.stringify({
        entries: [
          { name: '홍길동', studentId: '20250001' },
          { name: '김서연', studentId: '20250002' },
        ],
      }),
    })
    expect(put.status).toBe(200)

    const res = await api(`/surveys/${id}/allowlist`)
    expect(await res.json()).toEqual({
      entries: [
        { name: '김서연', studentId: '20250002' },
        { name: '홍길동', studentId: '20250001' },
      ],
    })
  })

  // 진행 중에 "쟤 빠졌네" 하고 한 명 더 넣는 것이 실제 사용 장면이다.
  // 문항 편집처럼 draft 로 잠그면 그 순간 관리자가 할 수 있는 일이 없다.
  it('열린 설문의 명단도 고칠 수 있다', async () => {
    const id = await createDraft()
    await api(`/surveys/${id}/open`, { method: 'POST' })

    const res = await api(`/surveys/${id}/allowlist`, {
      method: 'PUT',
      body: JSON.stringify({ entries: [{ name: '홍길동', studentId: '20250001' }] }),
    })
    expect(res.status).toBe(200)
  })

  it('빈 이름이 섞이면 거부한다', async () => {
    const id = await createDraft()
    const res = await api(`/surveys/${id}/allowlist`, {
      method: 'PUT',
      body: JSON.stringify({ entries: [{ name: '  ', studentId: '20250001' }] }),
    })
    expect(res.status).toBe(400)
  })

  it('없는 설문의 명단은 404 다', async () => {
    const res = await api('/surveys/nosuch/allowlist')
    expect(res.status).toBe(404)
  })

  it('참가·미참가·명단 밖을 갈라서 돌려준다', async () => {
    const id = await createDraft()
    await api(`/surveys/${id}/allowlist`, {
      method: 'PUT',
      body: JSON.stringify({
        entries: [
          { name: '홍길동', studentId: '20250001' },
          { name: '김서연', studentId: '20250002' },
        ],
      }),
    })
    await addParticipant(id, '홍길동', '20250001')
    await addParticipant(id, '낯선이', '20259999')

    const res = await api(`/surveys/${id}/roster`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      enabled: true,
      participated: [{ name: '홍길동', studentId: '20250001' }],
      notParticipated: [{ name: '김서연', studentId: '20250002' }],
      unlisted: [{ name: '낯선이', studentId: '20259999' }],
    })
  })

  it('없는 설문의 현황은 404 다', async () => {
    const res = await api('/surveys/nosuch/roster')
    expect(res.status).toBe(404)
  })
})

describe('예약 마감', () => {
  it('시각을 저장하고 설문에 실어 내려준다', async () => {
    const id = await createDraft()
    const closeAt = Date.now() + 60 * 60 * 1000

    const res = await api(`/surveys/${id}/schedule`, {
      method: 'POST',
      body: JSON.stringify({ closeAt }),
    })
    expect(res.status).toBe(200)

    const survey = await (await api(`/surveys/${id}`)).json<{ closeAt: number | null }>()
    expect(survey.closeAt).toBe(closeAt)
  })

  it('null 로 예약을 지운다', async () => {
    const id = await createDraft()
    await api(`/surveys/${id}/schedule`, {
      method: 'POST',
      body: JSON.stringify({ closeAt: Date.now() + 1000 }),
    })

    await api(`/surveys/${id}/schedule`, { method: 'POST', body: JSON.stringify({ closeAt: null }) })

    const survey = await (await api(`/surveys/${id}`)).json<{ closeAt: number | null }>()
    expect(survey.closeAt).toBeNull()
  })

  it('시각이 아닌 값을 거부한다', async () => {
    const id = await createDraft()
    const res = await api(`/surveys/${id}/schedule`, {
      method: 'POST',
      body: JSON.stringify({ closeAt: '내일' }),
    })
    expect(res.status).toBe(400)
  })

  it('없는 설문에는 404 다', async () => {
    const res = await api('/surveys/nope/schedule', {
      method: 'POST',
      body: JSON.stringify({ closeAt: null }),
    })
    expect(res.status).toBe(404)
  })

  it('지난 시각을 걸어 두면 그다음 읽기에서 마감되어 나온다', async () => {
    const id = await createDraft()
    await api(`/surveys/${id}/open`, { method: 'POST' })
    await api(`/surveys/${id}/schedule`, {
      method: 'POST',
      body: JSON.stringify({ closeAt: Date.now() - 1000 }),
    })

    const survey = await (await api(`/surveys/${id}`)).json<{ status: string }>()
    expect(survey.status).toBe('closed')
  })
})

describe('설문 삭제', () => {
  it('지우면 목록과 상세에서 모두 사라진다', async () => {
    const id = await createDraft()

    const res = await api(`/surveys/${id}`, { method: 'DELETE' })
    expect(res.status).toBe(200)

    expect((await api(`/surveys/${id}`)).status).toBe(404)
    const list = await (await api('/surveys')).json<Array<{ id: string }>>()
    expect(list.find((s) => s.id === id)).toBeUndefined()
  })

  it('없는 설문을 지우려 하면 404 다', async () => {
    expect((await api('/surveys/nope', { method: 'DELETE' })).status).toBe(404)
  })
})
