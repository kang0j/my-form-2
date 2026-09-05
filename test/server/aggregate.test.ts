import { describe, expect, it } from 'vitest'
import type { QuestionDef, SurveyDef } from '../../src/shared/schema'
import { aggregateSurvey, type AnswerRow } from '../../src/server/aggregate'

/** 문항 목록을 한 화면짜리 설문으로 감싼다 — 집계는 설문 전체를 받는다. */
function surveyOf(questions: QuestionDef[]): SurveyDef {
  return {
    id: 's',
    title: '설문',
    description: '',
    status: 'closed',
    resultsVisibility: 'after_close',
    closeAt: null,
    sections: [{ id: 'sec1', questions }],
  }
}

const singleQ: QuestionDef = {
  id: 'q1s',
  type: 'single',
  title: '가장 좋아하는 것',
  description: '',
  required: false,
  minSelect: null,
  maxSelect: null,
  allowOther: false,
  options: [
    { id: 's1', label: '사과', isOther: false },
    { id: 's2', label: '배', isOther: false },
  ],
  rules: [],
}

const choiceQ: QuestionDef = {
  id: 'q1',
  type: 'multi',
  title: '좋아하는 것',
  description: '',
  required: false,
  minSelect: null,
  maxSelect: null,
  allowOther: true,
  options: [
    { id: 'o1', label: '사과', isOther: false },
    { id: 'o2', label: '배', isOther: false },
    { id: 'o3', label: '기타', isOther: true },
  ],
  rules: [],
}

const textQ: QuestionDef = {
  id: 'q2',
  type: 'text',
  title: '한마디',
  description: '',
  required: false,
  minSelect: null,
  maxSelect: null,
  allowOther: false,
  options: [],
  rules: [],
}

const rankingQ: QuestionDef = {
  id: 'q3',
  type: 'ranking',
  title: '순위',
  description: '',
  required: false,
  minSelect: null,
  maxSelect: null,
  allowOther: false,
  options: [
    { id: 'r1', label: '가', isOther: false },
    { id: 'r2', label: '나', isOther: false },
    { id: 'r3', label: '다', isOther: false },
  ],
  rules: [],
}

function row(partial: Partial<AnswerRow> & { submissionId: string; questionId: string }): AnswerRow {
  return { optionId: null, textValue: null, rankPosition: null, ...partial }
}

describe('선택형 집계', () => {
  it('보기별 개수를 센다', () => {
    const rows = [
      row({ submissionId: 's1', questionId: 'q1', optionId: 'o1' }),
      row({ submissionId: 's1', questionId: 'q1', optionId: 'o2' }),
      row({ submissionId: 's2', questionId: 'q1', optionId: 'o1' }),
    ]
    const [result] = aggregateSurvey(surveyOf([choiceQ]), rows)
    expect(result).toMatchObject({
      questionId: 'q1',
      type: 'multi',
      respondentCount: 2,
      counts: [
        { optionId: 'o1', label: '사과', count: 2 },
        { optionId: 'o2', label: '배', count: 1 },
        { optionId: 'o3', label: '기타', count: 0 },
      ],
    })
  })

  it('보기 순서를 정의 순서 그대로 유지한다', () => {
    const rows = [row({ submissionId: 's1', questionId: 'q1', optionId: 'o2' })]
    const [result] = aggregateSurvey(surveyOf([choiceQ]), rows)
    if (result.type !== 'multi') throw new Error('타입 불일치')
    expect(result.counts.map((c) => c.optionId)).toEqual(['o1', 'o2', 'o3'])
  })

  it('기타 입력 내용을 모은다', () => {
    const rows = [
      row({ submissionId: 's1', questionId: 'q1', optionId: 'o3', textValue: '포도' }),
      row({ submissionId: 's2', questionId: 'q1', optionId: 'o3', textValue: '감' }),
    ]
    const [result] = aggregateSurvey(surveyOf([choiceQ]), rows)
    if (result.type !== 'multi') throw new Error('타입 불일치')
    expect(result.otherTexts.sort()).toEqual(['감', '포도'])
  })

  it('응답이 없으면 전부 0 이다', () => {
    const [result] = aggregateSurvey(surveyOf([choiceQ]), [])
    if (result.type !== 'multi') throw new Error('타입 불일치')
    expect(result.respondentCount).toBe(0)
    expect(result.counts.every((c) => c.count === 0)).toBe(true)
  })
})

describe('단일 선택 집계', () => {
  it('보기별 개수를 센다 — multi 와 같은 경로를 single 로도 확인한다', () => {
    const rows = [
      row({ submissionId: 's1', questionId: 'q1s', optionId: 's1' }),
      row({ submissionId: 's2', questionId: 'q1s', optionId: 's1' }),
      row({ submissionId: 's3', questionId: 'q1s', optionId: 's2' }),
    ]
    const [result] = aggregateSurvey(surveyOf([singleQ]), rows)
    expect(result).toMatchObject({
      questionId: 'q1s',
      type: 'single',
      respondentCount: 3,
      counts: [
        { optionId: 's1', label: '사과', count: 2 },
        { optionId: 's2', label: '배', count: 1 },
      ],
    })
  })
})

describe('주관식 집계', () => {
  it('내용을 모으고 응답자 수를 센다', () => {
    const rows = [
      row({ submissionId: 's1', questionId: 'q2', textValue: '좋아요' }),
      row({ submissionId: 's2', questionId: 'q2', textValue: '괜찮아요' }),
    ]
    const [result] = aggregateSurvey(surveyOf([textQ]), rows)
    expect(result).toMatchObject({ type: 'text', respondentCount: 2 })
    if (result.type !== 'text') throw new Error('타입 불일치')
    expect(result.texts.sort()).toEqual(['괜찮아요', '좋아요'])
  })

  it('빈 문자열 응답은 texts 에서 걸러낸다', () => {
    const rows = [
      row({ submissionId: 's1', questionId: 'q2', textValue: '' }),
      row({ submissionId: 's2', questionId: 'q2', textValue: '좋아요' }),
    ]
    const [result] = aggregateSurvey(surveyOf([textQ]), rows)
    if (result.type !== 'text') throw new Error('타입 불일치')
    expect(result.texts).toEqual(['좋아요'])
    // respondentCount 는 submissionId 기준이라 빈 응답도 응답자로는 센다.
    expect(result.respondentCount).toBe(2)
  })
})

describe('랭킹 집계', () => {
  it('보르다 점수를 매긴다 — N개 중 k위는 N−k점', () => {
    // 3개 항목: 1위 2점, 2위 1점, 3위 0점
    const rows = [
      row({ submissionId: 's1', questionId: 'q3', optionId: 'r1', rankPosition: 1 }),
      row({ submissionId: 's1', questionId: 'q3', optionId: 'r2', rankPosition: 2 }),
      row({ submissionId: 's1', questionId: 'q3', optionId: 'r3', rankPosition: 3 }),
      row({ submissionId: 's2', questionId: 'q3', optionId: 'r2', rankPosition: 1 }),
      row({ submissionId: 's2', questionId: 'q3', optionId: 'r1', rankPosition: 2 }),
      row({ submissionId: 's2', questionId: 'q3', optionId: 'r3', rankPosition: 3 }),
    ]
    const [result] = aggregateSurvey(surveyOf([rankingQ]), rows)
    if (result.type !== 'ranking') throw new Error('타입 불일치')
    expect(result.scores).toEqual([
      { optionId: 'r1', label: '가', score: 3, distribution: [1, 1, 0] },
      { optionId: 'r2', label: '나', score: 3, distribution: [1, 1, 0] },
      { optionId: 'r3', label: '다', score: 0, distribution: [0, 0, 2] },
    ])
  })

  it('범위를 벗어난 순위는 점수에도 분포에도 반영하지 않는다', () => {
    const rows = [
      row({ submissionId: 's1', questionId: 'q3', optionId: 'r1', rankPosition: 99 }),
    ]
    const [result] = aggregateSurvey(surveyOf([rankingQ]), rows)
    if (result.type !== 'ranking') throw new Error('타입 불일치')
    const r1 = result.scores.find((s) => s.optionId === 'r1')!
    expect(r1.score).toBe(0)
    expect(r1.distribution).toEqual([0, 0, 0])
  })

  it('점수가 높은 순으로 정렬한다', () => {
    const rows = [
      row({ submissionId: 's1', questionId: 'q3', optionId: 'r3', rankPosition: 1 }),
      row({ submissionId: 's1', questionId: 'q3', optionId: 'r1', rankPosition: 2 }),
      row({ submissionId: 's1', questionId: 'q3', optionId: 'r2', rankPosition: 3 }),
    ]
    const [result] = aggregateSurvey(surveyOf([rankingQ]), rows)
    if (result.type !== 'ranking') throw new Error('타입 불일치')
    expect(result.scores.map((s) => s.optionId)).toEqual(['r3', 'r1', 'r2'])
  })
})

describe('문항 간 위치 상관 차단', () => {
  it('두 주관식 문항의 texts 는 같은 제출 순서로 오지 않는다', () => {
    const textQ2: QuestionDef = { ...textQ, id: 'q2b' }
    const rows = [
      row({ submissionId: 's1', questionId: 'q2', textValue: 'z-first' }),
      row({ submissionId: 's2', questionId: 'q2', textValue: 'a-second' }),
      row({ submissionId: 's3', questionId: 'q2', textValue: 'm-third' }),
      row({ submissionId: 's1', questionId: 'q2b', textValue: 'z-first-2' }),
      row({ submissionId: 's2', questionId: 'q2b', textValue: 'a-second-2' }),
      row({ submissionId: 's3', questionId: 'q2b', textValue: 'm-third-2' }),
    ]
    const [r1, r2] = aggregateSurvey(surveyOf([textQ, textQ2]), rows)
    if (r1.type !== 'text' || r2.type !== 'text') throw new Error('타입 불일치')

    // 값 기준 정렬이므로 각자 알파벳 순으로 나오고, 제출 순서(s1,s2,s3)로는 나오지 않는다.
    expect(r1.texts).toEqual(['a-second', 'm-third', 'z-first'])
    expect(r2.texts).toEqual(['a-second-2', 'm-third-2', 'z-first-2'])
  })

  it('선택형의 otherTexts 도 값 기준으로 정렬된다', () => {
    const rows = [
      row({ submissionId: 's1', questionId: 'q1', optionId: 'o3', textValue: 'z' }),
      row({ submissionId: 's2', questionId: 'q1', optionId: 'o3', textValue: 'a' }),
    ]
    const [result] = aggregateSurvey(surveyOf([choiceQ]), rows)
    if (result.type !== 'multi') throw new Error('타입 불일치')
    expect(result.otherTexts).toEqual(['a', 'z'])
  })
})

describe('다른 문항의 행', () => {
  it('문항별로 행을 갈라 집계한다', () => {
    const rows = [
      row({ submissionId: 's1', questionId: 'q1', optionId: 'o1' }),
      row({ submissionId: 's1', questionId: 'q2', textValue: '한마디' }),
    ]
    const results = aggregateSurvey(surveyOf([choiceQ, textQ]), rows)
    expect(results[0].respondentCount).toBe(1)
    expect(results[1].respondentCount).toBe(1)
  })
})

describe('조건부 문항의 분모', () => {
  it('조건부 문항의 eligibleCount 는 그 문항을 본 제출만 센다', () => {
    const gate: QuestionDef = {
      id: 'gate',
      type: 'single',
      title: '수강합니까?',
      description: '',
      required: false,
      minSelect: null,
      maxSelect: null,
      allowOther: false,
      options: [
        { id: 'yes', label: '예', isOther: false },
        { id: 'no', label: '아니오', isOther: false },
      ],
      rules: [
        {
          match: 'all',
          action: 'show',
          targets: [{ kind: 'question', questionId: 'branch' }],
          conditions: [{ operator: 'is', optionId: 'yes' }],
        },
      ],
    }
    const branch: QuestionDef = { ...gate, id: 'branch', title: '찬성?', rules: [] }

    const survey: SurveyDef = {
      id: 's1',
      title: '설문',
      description: '',
      status: 'closed',
      resultsVisibility: 'after_close',
      closeAt: null,
      sections: [{ id: 'sec1', questions: [gate, branch] }],
    }

    // 세 명 중 한 명만 '예' 를 골라 branch 를 봤다.
    const rows: AnswerRow[] = [
      { submissionId: 'a', questionId: 'gate', optionId: 'yes', textValue: null, rankPosition: null },
      { submissionId: 'a', questionId: 'branch', optionId: 'yes', textValue: null, rankPosition: null },
      { submissionId: 'b', questionId: 'gate', optionId: 'no', textValue: null, rankPosition: null },
      { submissionId: 'c', questionId: 'gate', optionId: 'no', textValue: null, rankPosition: null },
    ]

    const results = aggregateSurvey(survey, rows)
    const branchResult = results.find((r) => r.questionId === 'branch')!
    const gateResult = results.find((r) => r.questionId === 'gate')!

    expect(gateResult.eligibleCount).toBe(3)
    expect(branchResult.eligibleCount).toBe(1)
    expect(branchResult.respondentCount).toBe(1)
  })
})
