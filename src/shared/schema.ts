import { z } from 'zod'

export type QuestionType = 'single' | 'multi' | 'text' | 'ranking'
export type SurveyStatus = 'draft' | 'open' | 'closed'
/**
 * 결과를 언제 누구에게 보일지.
 *
 * 둘 다 "마감 후"다. 마감 전에는 관리자에게도 보이지 않는다 — 진행 중에
 * 집계를 두 번 읽으면 그 사이 들어온 한 표가 델타로 드러나고, 점검 화면의
 * 참가자 시각이 그 한 표에 이름을 붙인다. 저장에서 시간축을 없앤 설계
 * (§0001_init.sql: answers 에 시각 컬럼을 두지 않는다)를 조회가 되살리는
 * 것을 막는 것이 이 타입이다. 그래서 예전의 'realtime' 은 없앴다.
 */
export type ResultsVisibility = 'admin' | 'after_close'

export type OptionDef = {
  id: string
  label: string
  isOther: boolean
}

export type ConditionOperator =
  | 'is'
  | 'is_not'
  | 'includes'
  | 'not_includes'
  | 'answered'
  | 'not_answered'

/**
 * 조건 한 줄. 어느 문항의 답을 보는지는 적지 않는다 — 언제나 이 규칙을
 * 소유한 문항 자신의 답이다. 조건이 남의 문항을 가리킬 수 있었을 때는
 * 규칙이 적힌 자리와 규칙이 읽는 자리가 달라서, 관리자가 「이 문항에서
 * 예를 고르면 무슨 일이 일어나나」를 한 자리에서 볼 수 없었다.
 */
export type ConditionDef = {
  operator: ConditionOperator
  /** answered·not_answered 는 값을 보지 않으므로 null 이다. */
  optionId: string | null
}

export type RuleTarget =
  | { kind: 'question'; questionId: string }
  | { kind: 'section'; sectionId: string }

/**
 * 소유 문항의 답이 조건에 맞을 때 대상들을 보이거나 숨긴다.
 *
 * 규칙은 답을 보는 문항이 소유한다 — 「이 문항에서 아니오면 2-1·2-2 를
 * 보임」이 한 문항 아래에 다 적힌다. 한 문항이 규칙을 여러 개 가질 수
 * 있다: 「예면 1번을 보임」과 「아니오면 2번을 보임」은 조건이 서로 다른
 * 두 규칙이지, 한 규칙의 AND/OR 로 적을 수 있는 것이 아니다.
 *
 * 충돌을 막는 것은 이제 대상당 지목 한 번뿐이다(스펙 §3.2). 한 대상을
 * 두 규칙이 함께 조종하지 못하므로, 규칙이 몇 개든 서로 다른 말을 할
 * 자리가 없다.
 */
export type RuleDef = {
  match: 'all' | 'any'
  action: 'show' | 'hide'
  targets: RuleTarget[]
  conditions: ConditionDef[]
}

export type QuestionDef = {
  id: string
  type: QuestionType
  title: string
  description: string
  required: boolean
  minSelect: number | null
  maxSelect: number | null
  allowOther: boolean
  options: OptionDef[]
  /** 이 문항이 소유한 조건 규칙들. 대부분의 문항은 빈 배열이다. */
  rules: RuleDef[]
}

/**
 * 섹션은 화면 한 장이다 — 그게 전부다.
 *
 * 제목도 설명도 없다: 투표자에게 섹션은 "여기까지가 한 화면"이라는 사실로만
 * 드러나고, 그 사실은 페이지가 끊기는 것으로 이미 말해진다. 이름을 붙이면
 * 관리자는 이름을 짓느라 고민하고 투표자는 읽지 않아도 될 제목을 읽는다.
 * 그래서 이 타입에는 id 와 그 안의 문항밖에 없다.
 */
export type SectionDef = {
  id: string
  questions: QuestionDef[]
}

export type SurveyDef = {
  id: string
  title: string
  description: string
  status: SurveyStatus
  resultsVisibility: ResultsVisibility
  /**
   * 예약 마감 시각(epoch ms). null 이면 예약이 없다.
   *
   * 이 값이 지났는데 status 가 'open' 인 SurveyDef 는 존재하지 않는다 —
   * 읽는 길목에서 먼저 정리한다(§settleDueSurveys). 그러니 이 값을 보고
   * "지금 열려 있나"를 다시 계산할 필요가 없고, 해서도 안 된다: 권위는
   * 언제나 status 하나다.
   */
  closeAt: number | null
  sections: SectionDef[]
}

/**
 * 설문의 모든 문항을 화면 순서대로 편다.
 *
 * 검증·집계·CSV·제출 기록은 문항이 어느 화면에 있었는지 전혀 상관하지
 * 않는다 — 섹션은 순전히 투표 화면을 끊는 개념이다. 그쪽 코드가 섹션을
 * 몰라도 되도록 여기서 한 번만 편다. 평면 목록을 SurveyDef 에 따로
 * 들고 다니지 않는 이유는 같은 문항이 두 군데 적히면 언젠가 두 곳이
 * 어긋나기 때문이다.
 */
export function allQuestions(survey: { sections: SectionDef[] }): QuestionDef[] {
  return survey.sections.flatMap((section) => section.questions)
}

const answerSchema = z.discriminatedUnion('type', [
  z.object({
    questionId: z.string().min(1),
    type: z.literal('single'),
    optionId: z.string().min(1),
    otherText: z.string().max(500).optional(),
  }),
  z.object({
    questionId: z.string().min(1),
    type: z.literal('multi'),
    optionIds: z.array(z.string().min(1)),
    otherText: z.string().max(500).optional(),
  }),
  z.object({
    questionId: z.string().min(1),
    type: z.literal('text'),
    text: z.string().max(2000),
  }),
  z.object({
    questionId: z.string().min(1),
    type: z.literal('ranking'),
    order: z.array(z.string().min(1)),
  }),
])

export const submissionSchema = z.object({
  name: z.string().trim().min(1).max(50),
  studentId: z.string().trim().min(1).max(30),
  browserKey: z.string().min(8).max(200),
  answers: z.array(answerSchema).max(100),
})

export type AnswerInput = z.infer<typeof answerSchema>
export type SubmissionInput = z.infer<typeof submissionSchema>

const optionDraftSchema = z.object({
  label: z.string().trim().min(1).max(200),
  isOther: z.boolean(),
})

const conditionDraftSchema = z.object({
  /** 보기는 allQuestions 순서가 아니라 소유 문항 안에서의 위치다. */
  operator: z.enum(['is', 'is_not', 'includes', 'not_includes', 'answered', 'not_answered']),
  optionIndex: z.number().int().min(0).nullable(),
})

const ruleTargetDraftSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('question'), questionIndex: z.number().int().min(0) }),
  z.object({ kind: z.literal('section'), sectionIndex: z.number().int().min(0) }),
])

const ruleDraftSchema = z.object({
  match: z.enum(['all', 'any']),
  action: z.enum(['show', 'hide']),
  // 상한 20 은 대상당 지목 한 번이라는 제약 위의 안전판일 뿐이다 — 한
  // 문항이 설문의 나머지 전부를 한 규칙으로 조종하는 초안은 실수일 때가
  // 많고, 그 실수를 저장 뒤가 아니라 저장 때 안다.
  targets: z.array(ruleTargetDraftSchema).min(1).max(20),
  conditions: z.array(conditionDraftSchema).min(1).max(8),
})

const questionDraftSchema = z
  .object({
    type: z.enum(['single', 'multi', 'text', 'ranking']),
    title: z.string().trim().min(1).max(300),
    description: z.string().max(1000).default(''),
    required: z.boolean(),
    minSelect: z.number().int().min(0).nullable(),
    maxSelect: z.number().int().min(1).nullable(),
    allowOther: z.boolean(),
    options: z.array(optionDraftSchema).max(50),
    // 규칙 없는 문항이 압도적으로 많으므로 빠뜨려도 통과시킨다 — 없음을
    // undefined 로도 빈 배열로도 적을 수 있게 두고, 읽는 쪽은 둘 다
    // "규칙 없음"으로 본다. 상한 8 은 한 문항의 보기 수를 넘는 규칙이
    // 실수가 아닐 도리가 없기 때문이다.
    rules: z.array(ruleDraftSchema).max(8).optional(),
  })
  .refine(
    (q) => q.type === 'text' || q.options.length >= 1,
    { message: '선택형·랭킹 문항에는 보기가 최소 1개 있어야 해요', path: ['options'] },
  )
  .refine(
    (q) => q.minSelect === null || q.maxSelect === null || q.minSelect <= q.maxSelect,
    { message: '최소 선택 개수는 최대보다 클 수 없어요', path: ['minSelect'] },
  )

/**
 * 빈 섹션도 통과시킨다. 편집 중에 문항을 다 지우면 잠깐 비는 것이 자연스럽고,
 * 그 순간 저장이 막히면 손이 묶인다. 빈 섹션은 투표 화면에서 그냥 건너뛰고,
 * "문항이 하나도 없는 설문은 열 수 없다"는 검사는 지금처럼 openSurvey 가
 * 설문 전체에 대해 한 번만 한다.
 */
const sectionDraftSchema = z.object({
  questions: z.array(questionDraftSchema).max(100),
})

export const surveyDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.string().max(2000).default(''),
    resultsVisibility: z.enum(['admin', 'after_close']),
    sections: z.array(sectionDraftSchema).max(20),
  })
  // 문항 상한 100개는 섹션이 생기기 전부터의 계약이다. 섹션마다 100개씩
  // 두면 섹션을 늘리는 것만으로 상한이 사라지므로 설문 전체로 다시 센다.
  .refine(
    (draft) => draft.sections.reduce((n, s) => n + s.questions.length, 0) <= 100,
    { message: '문항은 설문 전체에서 100개까지예요', path: ['sections'] },
  )

export type SurveyDraftInput = z.infer<typeof surveyDraftSchema>
export type ConditionDraft = z.infer<typeof conditionDraftSchema>
export type RuleTargetDraft = z.infer<typeof ruleTargetDraftSchema>
export type RuleDraft = z.infer<typeof ruleDraftSchema>
