import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SurveyDraftInput } from '../../src/shared/schema'
import {
  SurveyNotFoundError,
  SurveyStateError,
  closeSurvey,
  createSurvey,
  duplicateSurvey,
  getSurvey,
  listSurveys,
  openSurvey,
  reopenSurvey,
  deleteSurvey,
  replaceSurveyDraft,
  setCloseAt,
  setResultsVisibility,
} from '../../src/server/db/surveys'

const NOW = Date.UTC(2026, 8, 2, 1, 0)

const draft: SurveyDraftInput = {
  title: '동아리 회장 선거',
  description: '익명 투표입니다',
  resultsVisibility: 'after_close',
  sections: [{ questions: [
    {
      type: 'single',
      title: '누구를 지지하십니까?',
      description: '',
      required: true,
      minSelect: null,
      maxSelect: null,
      allowOther: false,
      options: [
        { label: '후보 A', isOther: false },
        { label: '후보 B', isOther: false },
      ],
    },
    {
      type: 'text',
      title: '하고 싶은 말',
      description: '',
      required: false,
      minSelect: null,
      maxSelect: null,
      allowOther: false,
      options: [],
    },
  ] }],
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM surveys').run()
})

describe('createSurvey / getSurvey', () => {
  it('설문과 문항, 보기를 순서대로 저장한다', async () => {
    const id = await createSurvey(env.DB, draft, NOW)
    const survey = await getSurvey(env.DB, id)

    expect(survey).not.toBeNull()
    expect(survey!.title).toBe('동아리 회장 선거')
    expect(survey!.status).toBe('draft')
    expect(survey!.resultsVisibility).toBe('after_close')
    expect(survey!.sections[0].questions.map((q) => q.title)).toEqual([
      '누구를 지지하십니까?',
      '하고 싶은 말',
    ])
    expect(survey!.sections[0].questions[0].options.map((o) => o.label)).toEqual(['후보 A', '후보 B'])
    expect(survey!.sections[0].questions[0].required).toBe(true)
    expect(survey!.sections[0].questions[1].options).toEqual([])
  })

  it('문항과 보기에 랜덤 UUID 를 부여한다', async () => {
    const id = await createSurvey(env.DB, draft, NOW)
    const survey = await getSurvey(env.DB, id)
    expect(survey!.sections[0].questions[0].id).toMatch(/^[0-9a-f-]{36}$/)
    expect(survey!.sections[0].questions[0].options[0].id).toMatch(/^[0-9a-f-]{36}$/)
  })

  // 설문 ID 만 링크에 실려 사람 손을 타므로 짧다 — 문항·보기 ID 는 그대로
  // UUID 다(바로 위 검사).
  it('설문 ID 는 대소문자·숫자 6자다', async () => {
    const id = await createSurvey(env.DB, draft, NOW)
    expect(id).toMatch(/^[A-Za-z0-9]{6}$/)
  })

  // 6자는 충돌이 "안 일어나는 일"이 아니다. 이미 쓰인 ID 가 뽑혔을 때
  // PRIMARY KEY 거부를 받아 다시 뽑는지 확인한다 — 첫 시도가 반드시
  // 충돌하도록 crypto.getRandomValues 를 고정값으로 한 번 가로챈다.
  it('ID 가 겹치면 다시 뽑아 저장한다', async () => {
    const taken = await createSurvey(env.DB, draft, NOW)

    const real = crypto.getRandomValues.bind(crypto)
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let first = true
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      if (!first || !(array instanceof Uint8Array) || array.length !== 6) return real(array)
      first = false
      for (let i = 0; i < 6; i += 1) array[i] = alphabet.indexOf(taken[i])
      return array
    })

    try {
      const id = await createSurvey(env.DB, draft, NOW)
      // 가짜 바이트가 실제로 소비됐는지 — 이게 false 가 아니면 스파이가
      // 걸리지 않은 것이고, 아래 검사들은 충돌을 전혀 겪지 않은 채
      // 통과해버린다.
      expect(first).toBe(false)
      expect(id).not.toBe(taken)
      expect(id).toMatch(/^[A-Za-z0-9]{6}$/)
      expect(await getSurvey(env.DB, id)).not.toBeNull()
      // 충돌한 시도의 문항까지 통째로 물러났는지 — 첫 설문에는 문항이
      // 딱 draft 만큼만 남아 있어야 한다.
      const original = await getSurvey(env.DB, taken)
      expect(original!.sections[0].questions).toHaveLength(draft.sections[0].questions.length)
    } finally {
      spy.mockRestore()
    }
  })

  it('없는 설문에는 null 을 돌려준다', async () => {
    expect(await getSurvey(env.DB, 'no-such-survey')).toBeNull()
  })
})

describe('listSurveys', () => {
  it('참여자 수와 함께 목록을 돌려준다', async () => {
    const id = await createSurvey(env.DB, draft, NOW)
    await env.DB
      .prepare(
        `INSERT INTO participants (id, survey_id, name, student_id, submitted_at, ip_hash, ua_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind('p1', id, '홍길동', '20250001', NOW, 'iphash', 'uahash')
      .run()

    const list = await listSurveys(env.DB)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id, title: '동아리 회장 선거', participantCount: 1 })
  })
})

describe('상태 전이', () => {
  it('draft 를 열고 닫을 수 있다', async () => {
    const id = await createSurvey(env.DB, draft, NOW)
    await openSurvey(env.DB, id, NOW)
    expect((await getSurvey(env.DB, id))!.status).toBe('open')

    await closeSurvey(env.DB, id, NOW + 1000)
    expect((await getSurvey(env.DB, id))!.status).toBe('closed')
  })

  it('문항이 없는 설문은 열 수 없다', async () => {
    const id = await createSurvey(env.DB, { ...draft, sections: [{ questions: [] }] }, NOW)
    await expect(openSurvey(env.DB, id, NOW)).rejects.toBeInstanceOf(SurveyStateError)
  })

  // openSurvey 는 draft 전용으로 남는다 — 문항 0개 검사처럼 첫 개방에만
  // 있는 전제를 지고 있어서다. 마감한 설문을 다시 여는 일은 reopenSurvey 가
  // 맡는다(아래 '마감 후 재개').
  it('마감한 설문은 openSurvey 로는 열 수 없다', async () => {
    const id = await createSurvey(env.DB, draft, NOW)
    await openSurvey(env.DB, id, NOW)
    await closeSurvey(env.DB, id, NOW)
    await expect(openSurvey(env.DB, id, NOW)).rejects.toBeInstanceOf(SurveyStateError)
  })

  it('열리지 않은 설문은 마감할 수 없다', async () => {
    const id = await createSurvey(env.DB, draft, NOW)
    await expect(closeSurvey(env.DB, id, NOW)).rejects.toBeInstanceOf(SurveyStateError)
  })
})

describe('마감 후 재개', () => {
  it('마감한 설문을 다시 열면 열린 상태로 돌아온다', async () => {
    const id = await createSurvey(env.DB, draft, NOW)
    await openSurvey(env.DB, id, NOW)
    await closeSurvey(env.DB, id, NOW + 1000)

    await reopenSurvey(env.DB, id, NOW + 2000)
    expect((await getSurvey(env.DB, id))!.status).toBe('open')
  })

  // opened_at/closed_at 은 '지금 회차'를 가리킨다. 재개했는데 마감 시각이
  // 남아 있으면 열린 설문이 마감 시각을 들고 있는 상태가 된다.
  it('재개하면 마감 시각을 지우고 개방 시각을 새로 찍는다', async () => {
    const id = await createSurvey(env.DB, draft, NOW)
    await openSurvey(env.DB, id, NOW)
    await closeSurvey(env.DB, id, NOW + 1000)
    await reopenSurvey(env.DB, id, NOW + 2000)

    const row = await env.DB.prepare(
      'SELECT opened_at AS openedAt, closed_at AS closedAt FROM surveys WHERE id = ?',
    )
      .bind(id)
      .first<{ openedAt: number | null; closedAt: number | null }>()

    expect(row!.closedAt).toBeNull()
    expect(row!.openedAt).toBe(NOW + 2000)
  })

  it('아직 마감하지 않은 설문은 재개할 수 없다', async () => {
    const id = await createSurvey(env.DB, draft, NOW)
    await expect(reopenSurvey(env.DB, id, NOW)).rejects.toBeInstanceOf(SurveyStateError)

    await openSurvey(env.DB, id, NOW)
    await expect(reopenSurvey(env.DB, id, NOW)).rejects.toBeInstanceOf(SurveyStateError)
  })

  it('재개한 설문은 다시 마감할 수 있다', async () => {
    const id = await createSurvey(env.DB, draft, NOW)
    await openSurvey(env.DB, id, NOW)
    await closeSurvey(env.DB, id, NOW + 1000)
    await reopenSurvey(env.DB, id, NOW + 2000)

    await closeSurvey(env.DB, id, NOW + 3000)
    expect((await getSurvey(env.DB, id))!.status).toBe('closed')
  })
})

describe('편집 잠금', () => {
  it('draft 상태에서는 문항을 교체할 수 있다', async () => {
    const id = await createSurvey(env.DB, draft, NOW)
    await replaceSurveyDraft(env.DB, id, { ...draft, title: '바뀐 제목' })

    const survey = await getSurvey(env.DB, id)
    expect(survey!.title).toBe('바뀐 제목')
    expect(survey!.sections[0].questions).toHaveLength(2)
  })

  it('열린 설문의 문항은 바꿀 수 없다', async () => {
    const id = await createSurvey(env.DB, draft, NOW)
    await openSurvey(env.DB, id, NOW)
    await expect(replaceSurveyDraft(env.DB, id, draft)).rejects.toBeInstanceOf(SurveyStateError)
  })

  it('마감 후에도 결과 공개 설정은 바꿀 수 있다', async () => {
    const id = await createSurvey(env.DB, draft, NOW)
    await openSurvey(env.DB, id, NOW)
    await closeSurvey(env.DB, id, NOW)
    await setResultsVisibility(env.DB, id, 'after_close')
    expect((await getSurvey(env.DB, id))!.resultsVisibility).toBe('after_close')
  })
})

describe('없는 설문', () => {
  // requireStatus/getSurvey 는 SurveyNotFoundError(404 로 매핑)와
  // SurveyStateError(409)를 구별한다 — 이 갈래는 있는 설문의 상태 전이
  // 테스트만으로는 지나가지 않는다.
  it('replaceSurveyDraft 는 SurveyNotFoundError 를 던진다', async () => {
    await expect(replaceSurveyDraft(env.DB, 'no-such-survey', draft)).rejects.toBeInstanceOf(
      SurveyNotFoundError,
    )
  })

  it('openSurvey 는 SurveyNotFoundError 를 던진다', async () => {
    await expect(openSurvey(env.DB, 'no-such-survey', NOW)).rejects.toBeInstanceOf(
      SurveyNotFoundError,
    )
  })

  it('closeSurvey 는 SurveyNotFoundError 를 던진다', async () => {
    await expect(closeSurvey(env.DB, 'no-such-survey', NOW)).rejects.toBeInstanceOf(
      SurveyNotFoundError,
    )
  })

  it('reopenSurvey 는 SurveyNotFoundError 를 던진다', async () => {
    await expect(reopenSurvey(env.DB, 'no-such-survey', NOW)).rejects.toBeInstanceOf(
      SurveyNotFoundError,
    )
  })

  it('duplicateSurvey 는 SurveyNotFoundError 를 던진다', async () => {
    await expect(duplicateSurvey(env.DB, 'no-such-survey', NOW)).rejects.toBeInstanceOf(
      SurveyNotFoundError,
    )
  })
})

describe('duplicateSurvey', () => {
  it('문항을 복사한 새 draft 를 만든다', async () => {
    const id = await createSurvey(env.DB, draft, NOW)
    await openSurvey(env.DB, id, NOW)

    const copyId = await duplicateSurvey(env.DB, id, NOW + 5000)
    expect(copyId).not.toBe(id)

    const copy = await getSurvey(env.DB, copyId)
    expect(copy!.status).toBe('draft')
    expect(copy!.title).toBe('동아리 회장 선거 (사본)')
    expect(copy!.sections[0].questions.map((q) => q.title)).toEqual(
      draft.sections[0].questions.map((q) => q.title),
    )
  })

  it('사본의 문항 ID 는 원본과 다르다', async () => {
    const id = await createSurvey(env.DB, draft, NOW)
    const copyId = await duplicateSurvey(env.DB, id, NOW)
    const original = await getSurvey(env.DB, id)
    const copy = await getSurvey(env.DB, copyId)
    expect(copy!.sections[0].questions[0].id).not.toBe(original!.sections[0].questions[0].id)
  })
})

describe('섹션', () => {
  const twoSections = {
    ...draft,
    sections: [
      { questions: [draft.sections[0].questions[0]] },
      { questions: [draft.sections[0].questions[1]] },
    ],
  }

  it('섹션을 순서대로 저장하고 그 순서대로 돌려준다', async () => {
    const id = await createSurvey(env.DB, twoSections, NOW)
    const survey = await getSurvey(env.DB, id)

    expect(survey!.sections).toHaveLength(2)
    expect(survey!.sections[0].questions.map((q) => q.title)).toEqual(['누구를 지지하십니까?'])
    expect(survey!.sections[1].questions.map((q) => q.title)).toEqual(['하고 싶은 말'])
  })

  it('문항 순서는 섹션 안에서 매긴다', async () => {
    const id = await createSurvey(env.DB, twoSections, NOW)

    const { results } = await env.DB.prepare(
      `SELECT q.position AS position, s.position AS sectionPosition
       FROM questions q JOIN sections s ON s.id = q.section_id
       WHERE q.survey_id = ? ORDER BY s.position`,
    )
      .bind(id)
      .all<{ position: number; sectionPosition: number }>()

    // 두 문항 모두 자기 섹션의 첫 번째다 — 설문 전체 통번호가 아니다.
    expect(results.map((r) => r.position)).toEqual([0, 0])
    expect(results.map((r) => r.sectionPosition)).toEqual([0, 1])
  })

  it('빈 섹션도 그대로 저장하고 돌려준다', async () => {
    const id = await createSurvey(
      env.DB,
      { ...draft, sections: [{ questions: [] }, draft.sections[0]] },
      NOW,
    )
    const survey = await getSurvey(env.DB, id)

    expect(survey!.sections).toHaveLength(2)
    expect(survey!.sections[0].questions).toEqual([])
    expect(survey!.sections[1].questions).toHaveLength(2)
  })

  it('초안을 다시 저장하면 이전 섹션이 남지 않는다', async () => {
    const id = await createSurvey(env.DB, twoSections, NOW)
    await replaceSurveyDraft(env.DB, id, draft)

    const survey = await getSurvey(env.DB, id)
    expect(survey!.sections).toHaveLength(1)

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM sections WHERE survey_id = ?')
      .bind(id)
      .first<{ n: number }>()
    expect(count!.n).toBe(1)
  })

  it('복제본은 섹션 구조까지 그대로 물려받는다', async () => {
    const id = await createSurvey(env.DB, twoSections, NOW)
    const copyId = await duplicateSurvey(env.DB, id, NOW)
    const copy = await getSurvey(env.DB, copyId)

    expect(copy!.sections.map((s) => s.questions.map((q) => q.title))).toEqual([
      ['누구를 지지하십니까?'],
      ['하고 싶은 말'],
    ])
    // 섹션 id 는 새로 뽑는다 — 원본과 공유하지 않는다.
    const original = await getSurvey(env.DB, id)
    expect(copy!.sections[0].id).not.toBe(original!.sections[0].id)
  })
})

describe('조건 규칙', () => {
  const conditionalDraft = {
    title: '조건 설문',
    description: '',
    resultsVisibility: 'after_close' as const,
    sections: [
      {
        questions: [
          {
            type: 'single' as const,
            title: '수강합니까?',
            description: '',
            required: true,
            minSelect: null,
            maxSelect: null,
            allowOther: false,
            options: [
              { label: '예', isOther: false },
              { label: '아니오', isOther: false },
            ],
            rules: [
              {
                match: 'all' as const,
                action: 'show' as const,
                targets: [{ kind: 'question' as const, questionIndex: 1 }],
                conditions: [{ operator: 'is' as const, optionIndex: 0 }],
              },
            ],
          },
          {
            type: 'single' as const,
            title: '찬성합니까?',
            description: '',
            required: false,
            minSelect: null,
            maxSelect: null,
            allowOther: false,
            options: [
              { label: '찬성', isOther: false },
              { label: '반대', isOther: false },
            ],
            rules: [],
          },
        ],
      },
    ],
  }

  it('규칙을 저장하고 실제 ID 로 되읽는다', async () => {
    const id = await createSurvey(env.DB, conditionalDraft, 1000)
    const survey = await getSurvey(env.DB, id)

    const [first, second] = survey!.sections[0].questions
    expect(second.rules ?? []).toEqual([])
    expect(first.rules[0]).not.toBeNull()
    expect(first.rules[0]!.match).toBe('all')
    expect(first.rules[0]!.action).toBe('show')
    expect(first.rules[0]!.targets).toEqual([{ kind: 'question', questionId: second.id }])
    expect(first.rules[0]!.conditions).toEqual([{ operator: 'is', optionId: first.options[0].id }])
  })

  it('섹션 대상 규칙을 저장하고 되읽는다', async () => {
    const draft = {
      ...conditionalDraft,
      sections: [
        {
          questions: [
            {
              ...conditionalDraft.sections[0].questions[0],
              rules: [
                {
                  match: 'all' as const,
                  action: 'hide' as const,
                  targets: [{ kind: 'section' as const, sectionIndex: 1 }],
                  conditions: [{ operator: 'is' as const, optionIndex: 1 }],
                },
              ],
            },
          ],
        },
        { questions: [conditionalDraft.sections[0].questions[1]] },
      ],
    }

    const id = await createSurvey(env.DB, draft, 1000)
    const survey = await getSurvey(env.DB, id)
    const rule = survey!.sections[0].questions[0].rules[0]!

    expect(rule.action).toBe('hide')
    expect(rule.targets).toEqual([{ kind: 'section', sectionId: survey!.sections[1].id }])
  })

  it('대상이 여럿인 규칙을 저장하고 순서대로 되읽는다', async () => {
    const third = { ...conditionalDraft.sections[0].questions[1], title: '왜 그런가요?' }
    const draft = {
      ...conditionalDraft,
      sections: [
        {
          questions: [
            {
              ...conditionalDraft.sections[0].questions[0],
              rules: [
                {
                  match: 'all' as const,
                  action: 'show' as const,
                  targets: [
                    { kind: 'question' as const, questionIndex: 1 },
                    { kind: 'question' as const, questionIndex: 2 },
                    { kind: 'section' as const, sectionIndex: 1 },
                  ],
                  conditions: [{ operator: 'is' as const, optionIndex: 1 }],
                },
              ],
            },
            conditionalDraft.sections[0].questions[1],
            third,
          ],
        },
        { questions: [{ ...third, title: '넷째' }] },
      ],
    }

    const id = await createSurvey(env.DB, draft, 1000)
    const survey = await getSurvey(env.DB, id)
    const [first, second, thirdSaved] = survey!.sections[0].questions

    expect(first.rules[0]!.targets).toEqual([
      { kind: 'question', questionId: second.id },
      { kind: 'question', questionId: thirdSaved.id },
      { kind: 'section', sectionId: survey!.sections[1].id },
    ])
  })

  it('한 문항의 규칙 두 개를 순서대로 저장하고 되읽는다', async () => {
    const draft = {
      ...conditionalDraft,
      sections: [
        {
          questions: [
            {
              ...conditionalDraft.sections[0].questions[0],
              rules: [
                {
                  match: 'all' as const,
                  action: 'show' as const,
                  targets: [{ kind: 'question' as const, questionIndex: 1 }],
                  conditions: [{ operator: 'is' as const, optionIndex: 0 }],
                },
                {
                  match: 'all' as const,
                  action: 'show' as const,
                  targets: [{ kind: 'question' as const, questionIndex: 2 }],
                  conditions: [{ operator: 'is' as const, optionIndex: 1 }],
                },
              ],
            },
            conditionalDraft.sections[0].questions[1],
            { ...conditionalDraft.sections[0].questions[1], title: '왜 그런가요?' },
          ],
        },
      ],
    }

    const id = await createSurvey(env.DB, draft, 1000)
    const survey = await getSurvey(env.DB, id)
    const [first, second, third] = survey!.sections[0].questions

    expect(first.rules).toHaveLength(2)
    expect(first.rules[0].targets).toEqual([{ kind: 'question', questionId: second.id }])
    expect(first.rules[0].conditions[0].optionId).toBe(first.options[0].id)
    expect(first.rules[1].targets).toEqual([{ kind: 'question', questionId: third.id }])
    expect(first.rules[1].conditions[0].optionId).toBe(first.options[1].id)
  })

  it('초안을 교체하면 옛 대상 행이 남지 않는다', async () => {
    const id = await createSurvey(env.DB, conditionalDraft, 1000)
    await replaceSurveyDraft(env.DB, id, {
      ...conditionalDraft,
      sections: [
        {
          questions: conditionalDraft.sections[0].questions.map((q) => ({ ...q, rules: [] })),
        },
      ],
    })

    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM rule_targets').first<{ n: number }>()
    expect(left!.n).toBe(0)
  })

  it('초안을 교체하면 옛 규칙이 남지 않는다', async () => {
    const id = await createSurvey(env.DB, conditionalDraft, 1000)

    const plain = {
      ...conditionalDraft,
      sections: [
        {
          questions: conditionalDraft.sections[0].questions.map((q) => ({ ...q, rules: [] })),
        },
      ],
    }
    await replaceSurveyDraft(env.DB, id, plain)

    const survey = await getSurvey(env.DB, id)
    expect(survey!.sections[0].questions.every((q) => q.rules.length === 0)).toBe(true)

    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM question_rules').first<{ n: number }>()
    expect(left!.n).toBe(0)
  })

  it('복제본이 규칙까지 그대로 들고 간다', async () => {
    const id = await createSurvey(env.DB, conditionalDraft, 1000)
    const copyId = await duplicateSurvey(env.DB, id, 2000)

    const copy = await getSurvey(env.DB, copyId)
    const [first, second] = copy!.sections[0].questions

    expect(first.rules[0]).not.toBeNull()
    // 복제본의 규칙은 복제본 자신의 문항을 가리켜야 한다 — 원본을 가리키면
    // 원본을 지우는 순간 복제본의 규칙이 함께 사라진다.
    expect(first.rules[0]!.targets).toEqual([{ kind: 'question', questionId: second.id }])
    expect(first.rules[0]!.conditions[0].optionId).toBe(first.options[0].id)
  })
})

describe('예약 마감', () => {
  const HOUR = 60 * 60 * 1000

  async function openedSurvey(closeAt: number | null): Promise<string> {
    const id = await createSurvey(env.DB, draft, NOW)
    await openSurvey(env.DB, id, NOW)
    await setCloseAt(env.DB, id, closeAt)
    return id
  }

  it('예약이 없으면 아무 일도 없다', async () => {
    const id = await openedSurvey(null)
    const survey = await getSurvey(env.DB, id, NOW + 1000 * HOUR)

    expect(survey!.status).toBe('open')
    expect(survey!.closeAt).toBeNull()
  })

  it('시각 전에는 열려 있다', async () => {
    const id = await openedSurvey(NOW + HOUR)
    const survey = await getSurvey(env.DB, id, NOW + HOUR - 1)

    expect(survey!.status).toBe('open')
    expect(survey!.closeAt).toBe(NOW + HOUR)
  })

  it('시각이 지나면 읽는 순간 마감된다', async () => {
    const id = await openedSurvey(NOW + HOUR)
    const survey = await getSurvey(env.DB, id, NOW + HOUR)

    expect(survey!.status).toBe('closed')
  })

  it('마감 시각은 누가 열어 본 시각이 아니라 관리자가 정한 시각으로 남는다', async () => {
    const id = await openedSurvey(NOW + HOUR)
    await getSurvey(env.DB, id, NOW + 5 * HOUR)

    const row = await env.DB.prepare('SELECT status, closed_at AS closedAt FROM surveys WHERE id = ?')
      .bind(id)
      .first<{ status: string; closedAt: number }>()

    expect(row!.status).toBe('closed')
    expect(row!.closedAt).toBe(NOW + HOUR)
  })

  it('목록도 같은 판정을 거친다', async () => {
    const id = await openedSurvey(NOW + HOUR)
    const list = await listSurveys(env.DB, NOW + 2 * HOUR)

    expect(list.find((s) => s.id === id)!.status).toBe('closed')
  })

  it('다시 열면 예약도 함께 지워진다 — 열자마자 또 마감되면 안 된다', async () => {
    const id = await openedSurvey(NOW + HOUR)
    await getSurvey(env.DB, id, NOW + 2 * HOUR)

    await reopenSurvey(env.DB, id, NOW + 3 * HOUR)
    const survey = await getSurvey(env.DB, id, NOW + 4 * HOUR)

    expect(survey!.status).toBe('open')
    expect(survey!.closeAt).toBeNull()
  })

  it('아직 열지 않은 설문은 시각이 지나도 마감되지 않는다', async () => {
    const id = await createSurvey(env.DB, draft, NOW)
    await setCloseAt(env.DB, id, NOW + HOUR)

    const survey = await getSurvey(env.DB, id, NOW + 2 * HOUR)
    expect(survey!.status).toBe('draft')
  })

  it('예약을 지우면 시각이 지나도 열려 있다', async () => {
    const id = await openedSurvey(NOW + HOUR)
    await setCloseAt(env.DB, id, null)

    const survey = await getSurvey(env.DB, id, NOW + 2 * HOUR)
    expect(survey!.status).toBe('open')
  })

  it('없는 설문에 예약을 걸면 404 로 이어지는 오류를 낸다', async () => {
    await expect(setCloseAt(env.DB, 'nope', NOW)).rejects.toBeInstanceOf(SurveyNotFoundError)
  })
})

describe('deleteSurvey', () => {
  it('설문과 딸린 것들을 함께 지운다', async () => {
    const id = await createSurvey(env.DB, draft, NOW)

    await deleteSurvey(env.DB, id)

    expect(await getSurvey(env.DB, id)).toBeNull()
    const questions = await env.DB.prepare('SELECT COUNT(*) AS n FROM questions WHERE survey_id = ?')
      .bind(id)
      .first<{ n: number }>()
    const sections = await env.DB.prepare('SELECT COUNT(*) AS n FROM sections WHERE survey_id = ?')
      .bind(id)
      .first<{ n: number }>()
    expect(questions!.n).toBe(0)
    expect(sections!.n).toBe(0)
  })

  it('다른 설문은 건드리지 않는다', async () => {
    const keep = await createSurvey(env.DB, draft, NOW)
    const gone = await createSurvey(env.DB, draft, NOW)

    await deleteSurvey(env.DB, gone)

    expect(await getSurvey(env.DB, keep)).not.toBeNull()
  })

  it('마감이나 초안 여부로 막지 않는다', async () => {
    const id = await createSurvey(env.DB, draft, NOW)
    await openSurvey(env.DB, id, NOW)

    await deleteSurvey(env.DB, id)
    expect(await getSurvey(env.DB, id)).toBeNull()
  })

  it('없는 설문을 지우려 하면 알린다', async () => {
    await expect(deleteSurvey(env.DB, 'nope')).rejects.toBeInstanceOf(SurveyNotFoundError)
  })
})
