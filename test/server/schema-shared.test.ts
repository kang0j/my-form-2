import { describe, expect, it } from 'vitest'
import { submissionSchema, surveyDraftSchema, type SurveyDraftInput } from '../../src/shared/schema'

const validSubmission = {
  name: '홍길동',
  studentId: '20250001',
  browserKey: '11111111-2222-3333-4444-555555555555',
  answers: [
    { questionId: 'q1', type: 'single', optionId: 'o1' },
    { questionId: 'q2', type: 'multi', optionIds: ['o2', 'o3'], otherText: '직접 입력' },
    { questionId: 'q3', type: 'text', text: '자유 의견' },
    { questionId: 'q4', type: 'ranking', order: ['o4', 'o5'] },
  ],
}

describe('submissionSchema', () => {
  it('올바른 제출을 통과시킨다', () => {
    expect(submissionSchema.safeParse(validSubmission).success).toBe(true)
  })

  it('이름이 비어 있으면 거부한다', () => {
    const result = submissionSchema.safeParse({ ...validSubmission, name: '   ' })
    expect(result.success).toBe(false)
  })

  it('이름 앞뒤 공백을 잘라낸다', () => {
    const result = submissionSchema.parse({ ...validSubmission, name: '  홍길동  ' })
    expect(result.name).toBe('홍길동')
  })

  it('학번이 비어 있으면 거부한다', () => {
    expect(
      submissionSchema.safeParse({ ...validSubmission, studentId: '' }).success,
    ).toBe(false)
  })

  it('모르는 문항 타입을 거부한다', () => {
    const result = submissionSchema.safeParse({
      ...validSubmission,
      answers: [{ questionId: 'q1', type: 'slider', value: 3 }],
    })
    expect(result.success).toBe(false)
  })

  it('브라우저 키가 없으면 거부한다', () => {
    const { browserKey: _drop, ...withoutKey } = validSubmission
    expect(submissionSchema.safeParse(withoutKey).success).toBe(false)
  })
})

describe('surveyDraftSchema', () => {
  const validDraft: SurveyDraftInput = {
    title: '동아리 회장 선거',
    description: '',
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
    ] }],
  }

  it('올바른 설문 정의를 통과시킨다', () => {
    expect(surveyDraftSchema.safeParse(validDraft).success).toBe(true)
  })

  it('제목이 비어 있으면 거부한다', () => {
    expect(surveyDraftSchema.safeParse({ ...validDraft, title: '' }).success).toBe(false)
  })

  it('모르는 결과 공개 설정을 거부한다', () => {
    expect(
      surveyDraftSchema.safeParse({ ...validDraft, resultsVisibility: 'public' }).success,
    ).toBe(false)
  })

  it('선택형 문항에 보기가 없으면 거부한다', () => {
    const draft = structuredClone(validDraft)
    draft.sections[0].questions[0].options = []
    expect(surveyDraftSchema.safeParse(draft).success).toBe(false)
  })

  it('주관식 문항은 보기가 없어도 통과한다', () => {
    const draft = structuredClone(validDraft)
    draft.sections[0].questions[0] = {
      ...draft.sections[0].questions[0],
      type: 'text',
      options: [],
    }
    expect(surveyDraftSchema.safeParse(draft).success).toBe(true)
  })

  it('모르는 문항 타입을 거부한다', () => {
    const draft = structuredClone(validDraft)
    // @ts-expect-error 일부러 스키마 밖의 타입을 넣는다 — safeParse 는 unknown 을 받는다.
    draft.sections[0].questions[0].type = 'slider'
    expect(surveyDraftSchema.safeParse(draft).success).toBe(false)
  })

  it('최소 선택 개수가 최대보다 크면 거부하고 한국어 메시지·경로를 담는다', () => {
    const draft = structuredClone(validDraft)
    draft.sections[0].questions[0] = {
      ...draft.sections[0].questions[0],
      type: 'multi',
      minSelect: 5,
      maxSelect: 2,
    }
    const result = surveyDraftSchema.safeParse(draft)
    expect(result.success).toBe(false)
    if (result.success) throw new Error('통과하면 안 된다')
    const issue = result.error.issues.find((i) => i.message === '최소 선택 개수는 최대보다 클 수 없어요')
    expect(issue).toBeDefined()
    expect(issue!.path).toEqual(['sections', 0, 'questions', 0, 'minSelect'])
  })

  it('최소 선택 개수가 최대 이하이면 통과한다', () => {
    const draft = structuredClone(validDraft)
    draft.sections[0].questions[0] = {
      ...draft.sections[0].questions[0],
      type: 'multi',
      minSelect: 1,
      maxSelect: 2,
    }
    expect(surveyDraftSchema.safeParse(draft).success).toBe(true)
  })
})
