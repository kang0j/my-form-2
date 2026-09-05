import { describe, expect, it } from 'vitest'
import type { SurveyDef } from '../../src/shared/schema'
import {
  buildAnswers,
  emptyDraft,
  moveRankingItem,
  toggleMulti,
} from '../../src/client/vote/draft'

const survey: SurveyDef = {
  id: 's1',
  title: '설문',
  description: '',
  status: 'open',
  resultsVisibility: 'after_close',
  closeAt: null,
  sections: [{ id: 'sec1', questions: [
    {
      id: 'q1',
      type: 'single',
      title: '단일',
      description: '',
      required: false,
      minSelect: null,
      maxSelect: null,
      allowOther: false,
      options: [
        { id: 'o1', label: 'A', isOther: false },
        { id: 'o2', label: 'B', isOther: false },
      ],
      rules: [],
    },
    {
      id: 'q2',
      type: 'multi',
      title: '다중',
      description: '',
      required: false,
      minSelect: null,
      maxSelect: null,
      allowOther: true,
      options: [
        { id: 'o3', label: 'C', isOther: false },
        { id: 'o4', label: '기타', isOther: true },
      ],
      rules: [],
    },
    {
      id: 'q3',
      type: 'text',
      title: '주관식',
      description: '',
      required: false,
      minSelect: null,
      maxSelect: null,
      allowOther: false,
      options: [],
      rules: [],
    },
    {
      id: 'q4',
      type: 'ranking',
      title: '랭킹',
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
    },
  ] }],
}

describe('emptyDraft', () => {
  it('빈 초안을 만든다', () => {
    const draft = emptyDraft(survey)
    expect(draft.name).toBe('')
    expect(draft.studentId).toBe('')
    expect(draft.single).toEqual({})
    expect(draft.text).toEqual({})
  })

  it('랭킹은 보기 정의 순서로 시작한다', () => {
    expect(emptyDraft(survey).ranking.q4).toEqual(['r1', 'r2', 'r3'])
  })
})

describe('toggleMulti', () => {
  it('없으면 넣는다', () => {
    expect(toggleMulti(['a'], 'b')).toEqual(['a', 'b'])
  })

  it('있으면 뺀다', () => {
    expect(toggleMulti(['a', 'b'], 'a')).toEqual(['b'])
  })
})

describe('moveRankingItem', () => {
  it('항목을 위로 옮긴다', () => {
    expect(moveRankingItem(['a', 'b', 'c'], 1, 0)).toEqual(['b', 'a', 'c'])
  })

  it('항목을 아래로 옮긴다', () => {
    expect(moveRankingItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
  })

  it('범위를 벗어나면 그대로 둔다', () => {
    expect(moveRankingItem(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    expect(moveRankingItem(['a', 'b'], 1, 5)).toEqual(['a', 'b'])
  })
})

describe('buildAnswers', () => {
  it('답하지 않은 문항은 빼고 랭킹은 남긴다', () => {
    const answers = buildAnswers(survey, emptyDraft(survey))
    expect(answers).toEqual([{ questionId: 'q4', type: 'ranking', order: ['r1', 'r2', 'r3'] }])
  })

  it('단일 선택을 옮겨 담는다', () => {
    const draft = { ...emptyDraft(survey), single: { q1: 'o2' } }
    expect(buildAnswers(survey, draft)).toContainEqual({
      questionId: 'q1',
      type: 'single',
      optionId: 'o2',
    })
  })

  it('다중 선택과 기타 입력을 함께 담는다', () => {
    const draft = {
      ...emptyDraft(survey),
      multi: { q2: ['o3', 'o4'] },
      other: { q2: '직접 입력' },
    }
    expect(buildAnswers(survey, draft)).toContainEqual({
      questionId: 'q2',
      type: 'multi',
      optionIds: ['o3', 'o4'],
      otherText: '직접 입력',
    })
  })

  it('기타를 고르지 않았으면 기타 입력을 보내지 않는다', () => {
    const draft = { ...emptyDraft(survey), multi: { q2: ['o3'] }, other: { q2: '남은 값' } }
    expect(buildAnswers(survey, draft)).toContainEqual({
      questionId: 'q2',
      type: 'multi',
      optionIds: ['o3'],
    })
  })

  it('내용이 있는 주관식은 그대로 담는다', () => {
    const draft = { ...emptyDraft(survey), text: { q3: '좋아요' } }
    expect(buildAnswers(survey, draft)).toContainEqual({
      questionId: 'q3',
      type: 'text',
      text: '좋아요',
    })
  })

  it('단일 선택이 기타 보기이고 입력이 있으면 기타 입력을 함께 담는다', () => {
    const surveyWithOtherSingle: SurveyDef = {
      ...survey,
      sections: [
        {
          id: 'sec1',
          questions: survey.sections[0].questions.map((q) =>
            q.id === 'q1'
              ? { ...q, options: [q.options[0], { ...q.options[1], isOther: true }] }
              : q,
          ),
        },
      ],
    }
    const draft = {
      ...emptyDraft(surveyWithOtherSingle),
      single: { q1: 'o2' },
      other: { q1: '직접 입력' },
    }
    expect(buildAnswers(surveyWithOtherSingle, draft)).toContainEqual({
      questionId: 'q1',
      type: 'single',
      optionId: 'o2',
      otherText: '직접 입력',
    })
  })

  it('랭킹 답이 없으면 보기 정의 순서를 기본값으로 쓴다', () => {
    // emptyDraft 는 항상 ranking 을 채워 주므로, 그 키 자체가 없는 경우
    // (예: 저장된 이전 초안이 이 문항을 몰랐던 경우)를 흉내 낸다.
    const draft = emptyDraft(survey)
    delete draft.ranking.q4
    expect(buildAnswers(survey, draft)).toContainEqual({
      questionId: 'q4',
      type: 'ranking',
      order: ['r1', 'r2', 'r3'],
    })
  })

  it('공백뿐인 주관식은 보내지 않는다', () => {
    const draft = { ...emptyDraft(survey), text: { q3: '   ' } }
    const answers = buildAnswers(survey, draft)
    expect(answers.some((a) => a.questionId === 'q3')).toBe(false)
  })

  it('조건이 맞지 않아 숨은 문항의 답은 담지 않는다', () => {
    const gate = {
      id: 'gate',
      type: 'single' as const,
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
          match: 'all' as const,
          action: 'show' as const,
          targets: [{ kind: 'question' as const, questionId: 'branch' }],
          conditions: [{ operator: 'is' as const, optionId: 'yes' }],
        },
      ],
    }
    const branch = { ...gate, id: 'branch', title: '찬성합니까?', rules: [] }

    const survey = {
      id: 's1',
      title: '설문',
      description: '',
      status: 'open' as const,
      resultsVisibility: 'after_close' as const,
      closeAt: null,
      sections: [{ id: 'sec1', questions: [gate, branch] }],
    }

    // 초안에는 두 답이 다 남아 있다 — 되돌리면 복구되어야 하므로.
    const draft = {
      name: '',
      studentId: '',
      single: { gate: 'no', branch: 'yes' },
      multi: {},
      other: {},
      text: {},
      ranking: {},
    }

    const answers = buildAnswers(survey, draft)
    expect(answers.map((a) => a.questionId)).toEqual(['gate'])
  })
})
