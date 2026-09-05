import { allQuestions } from '../../shared/schema'
import type { AnswerInput, SurveyDef } from '../../shared/schema'
import { computeVisibility } from '../../shared/visibility'

export type VoteDraft = {
  name: string
  studentId: string
  single: Record<string, string>
  multi: Record<string, string[]>
  other: Record<string, string>
  text: Record<string, string>
  ranking: Record<string, string[]>
}

/**
 * localStorage 에 남기는 부분. name·studentId 는 뺀다: 기기를 공유하는 다음
 * 사람에게 이전 사람의 이름·학번과 답변이 함께 자동 채워지면 신원-응답 연결이
 * 그대로 노출된다. 인트로 단계에서 매번 새로 입력받는다.
 */
export type PersistedDraft = Omit<VoteDraft, 'name' | 'studentId'>

export function toPersisted(draft: VoteDraft): PersistedDraft {
  const { name: _name, studentId: _studentId, ...rest } = draft
  return rest
}

export function emptyDraft(survey: SurveyDef): VoteDraft {
  const ranking: Record<string, string[]> = {}
  for (const question of allQuestions(survey)) {
    if (question.type === 'ranking') {
      ranking[question.id] = question.options.map((o) => o.id)
    }
  }

  return { name: '', studentId: '', single: {}, multi: {}, other: {}, text: {}, ranking }
}

export function toggleMulti(selected: string[], optionId: string): string[] {
  return selected.includes(optionId)
    ? selected.filter((id) => id !== optionId)
    : [...selected, optionId]
}

export function moveRankingItem(order: string[], from: number, to: number): string[] {
  if (from < 0 || from >= order.length || to < 0 || to >= order.length) return order

  const next = [...order]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

export function buildAnswers(survey: SurveyDef, draft: VoteDraft): AnswerInput[] {
  const all = collectAnswers(survey, draft)
  const visible = computeVisibility(survey, new Map(all.map((a) => [a.questionId, a])))
  return all.filter((a) => visible.questions.has(a.questionId))
}

/**
 * 초안에 적힌 모든 답을 형식대로 편다. 가시성은 보지 않는다 — 가시성
 * 계산 자체가 답을 입력으로 받으므로 먼저 이것이 있어야 한다.
 */
export function collectAnswers(survey: SurveyDef, draft: VoteDraft): AnswerInput[] {
  const answers: AnswerInput[] = []

  for (const question of allQuestions(survey)) {
    const otherIds = new Set(question.options.filter((o) => o.isOther).map((o) => o.id))
    const otherText = draft.other[question.id]?.trim() ?? ''

    switch (question.type) {
      case 'single': {
        const optionId = draft.single[question.id]
        if (!optionId) break
        const answer: AnswerInput = { questionId: question.id, type: 'single', optionId }
        if (otherIds.has(optionId) && otherText !== '') answer.otherText = otherText
        answers.push(answer)
        break
      }
      case 'multi': {
        const optionIds = draft.multi[question.id] ?? []
        if (optionIds.length === 0) break
        const answer: AnswerInput = { questionId: question.id, type: 'multi', optionIds }
        if (optionIds.some((id) => otherIds.has(id)) && otherText !== '') {
          answer.otherText = otherText
        }
        answers.push(answer)
        break
      }
      case 'text': {
        const text = draft.text[question.id] ?? ''
        if (text.trim() === '') break
        answers.push({ questionId: question.id, type: 'text', text })
        break
      }
      case 'ranking': {
        const order = draft.ranking[question.id] ?? question.options.map((o) => o.id)
        answers.push({ questionId: question.id, type: 'ranking', order })
        break
      }
    }
  }

  return answers
}
