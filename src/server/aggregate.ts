import { allQuestions } from '../shared/schema'
import type { AnswerInput, QuestionDef, SurveyDef } from '../shared/schema'
import { computeVisibility } from '../shared/visibility'

export type AnswerRow = {
  submissionId: string
  questionId: string
  optionId: string | null
  textValue: string | null
  rankPosition: number | null
}

type ResultBase = {
  questionId: string
  title: string
  respondentCount: number
  /**
   * 이 문항을 본 제출 수. 조건에 걸리지 않은 문항은 전체 제출 수와 같다.
   *
   * respondentCount 만으로는 "안 보여서 답이 없는 것"과 "보였는데 안 답한
   * 것"이 구별되지 않아, 조건부 문항의 비율이 실제보다 낮아 보인다.
   */
  eligibleCount: number
}

export type ChoiceResult = ResultBase & {
  type: 'single' | 'multi'
  counts: Array<{ optionId: string; label: string; count: number }>
  otherTexts: string[]
}

export type TextResult = ResultBase & {
  type: 'text'
  texts: string[]
}

export type RankingResult = ResultBase & {
  type: 'ranking'
  scores: Array<{ optionId: string; label: string; score: number; distribution: number[] }>
}

export type QuestionResult = ChoiceResult | TextResult | RankingResult

function aggregateQuestion(
  question: QuestionDef,
  rows: AnswerRow[],
  eligibleCount: number,
): QuestionResult {
  const mine = rows.filter((r) => r.questionId === question.id)
  const respondentCount = new Set(mine.map((r) => r.submissionId)).size
  const base = {
    questionId: question.id,
    title: question.title,
    respondentCount,
    eligibleCount,
  }

  if (question.type === 'text') {
    return {
      ...base,
      type: 'text',
      // 값 기준으로 정렬한다: 제출 순서를 그대로 두면 다른 문항의 texts/otherTexts와
      // 같은 위치가 같은 응답자를 가리켜, 자유 서술을 문항 간에 이어붙여 재식별할 수 있다.
      texts: mine.map((r) => r.textValue ?? '').filter((t) => t !== '').sort(),
    }
  }

  if (question.type === 'ranking') {
    const optionCount = question.options.length
    const scores = question.options.map((option) => {
      const distribution = new Array<number>(optionCount).fill(0)
      let score = 0
      for (const r of mine) {
        if (r.optionId !== option.id || r.rankPosition === null) continue
        if (r.rankPosition < 1 || r.rankPosition > optionCount) continue
        score += optionCount - r.rankPosition
        distribution[r.rankPosition - 1] += 1
      }
      return { optionId: option.id, label: option.label, score, distribution }
    })
    scores.sort((a, b) => b.score - a.score)
    return { ...base, type: 'ranking', scores }
  }

  const otherOptionIds = new Set(question.options.filter((o) => o.isOther).map((o) => o.id))
  return {
    ...base,
    type: question.type,
    counts: question.options.map((option) => ({
      optionId: option.id,
      label: option.label,
      count: mine.filter((r) => r.optionId === option.id).length,
    })),
    otherTexts: mine
      .filter((r) => r.optionId !== null && otherOptionIds.has(r.optionId))
      .map((r) => r.textValue ?? '')
      .filter((t) => t !== '')
      .sort(),
  }
}

/**
 * 저장된 답 행을 AnswerInput 모양으로 되돌린다.
 *
 * 가시성 계산은 제출 형식(AnswerInput)을 입력으로 받으므로, 집계에서 다시
 * 돌리려면 이 변환이 필요하다. 기타 텍스트는 가시성 판정에 쓰이지 않으므로
 * 채우지 않는다.
 */
function answersFromRows(
  questions: QuestionDef[],
  rows: AnswerRow[],
): Map<string, AnswerInput> {
  const byQuestion = new Map<string, AnswerInput>()

  for (const question of questions) {
    const mine = rows.filter((r) => r.questionId === question.id)
    if (mine.length === 0) continue

    switch (question.type) {
      case 'single': {
        const optionId = mine[0].optionId
        if (optionId) byQuestion.set(question.id, { questionId: question.id, type: 'single', optionId })
        break
      }
      case 'multi': {
        const optionIds = mine.map((r) => r.optionId).filter((id): id is string => id !== null)
        byQuestion.set(question.id, { questionId: question.id, type: 'multi', optionIds })
        break
      }
      case 'text': {
        byQuestion.set(question.id, {
          questionId: question.id,
          type: 'text',
          text: mine[0].textValue ?? '',
        })
        break
      }
      case 'ranking': {
        const order = [...mine]
          .sort((a, b) => (a.rankPosition ?? 0) - (b.rankPosition ?? 0))
          .map((r) => r.optionId)
          .filter((id): id is string => id !== null)
        byQuestion.set(question.id, { questionId: question.id, type: 'ranking', order })
        break
      }
    }
  }

  return byQuestion
}

export function aggregateSurvey(survey: SurveyDef, rows: AnswerRow[]): QuestionResult[] {
  // 제출별로 답을 다시 묶어 그 사람이 무엇을 봤는지 되짚는다. 답 자체가
  // 가시성의 입력이므로(§computeVisibility) 저장된 것만으로 계산된다 —
  // "무엇을 봤는지"를 따로 기록해 두지 않는다. 그런 열은 명부와 응답을
  // 잇는 새 실마리가 될 수 있다.
  const bySubmission = new Map<string, AnswerRow[]>()
  for (const row of rows) {
    const list = bySubmission.get(row.submissionId)
    if (list) list.push(row)
    else bySubmission.set(row.submissionId, [row])
  }

  const questions = allQuestions(survey)
  const eligible = new Map<string, number>(questions.map((q) => [q.id, 0]))

  for (const submissionRows of bySubmission.values()) {
    const visible = computeVisibility(survey, answersFromRows(questions, submissionRows))
    for (const questionId of visible.questions) {
      eligible.set(questionId, (eligible.get(questionId) ?? 0) + 1)
    }
  }

  return questions.map((q) => aggregateQuestion(q, rows, eligible.get(q.id) ?? 0))
}
