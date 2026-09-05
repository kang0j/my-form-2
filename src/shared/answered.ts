import type { AnswerInput, QuestionDef } from './schema'

/** 이 답이 "답한 것"으로 셀 만한가. 빈 주관식과 빈 선택은 답이 아니다. */
export function isAnswered(question: QuestionDef, answer: AnswerInput | undefined): boolean {
  if (!answer) return false
  switch (answer.type) {
    case 'single':
      return answer.optionId.length > 0
    case 'multi':
      return answer.optionIds.length > 0
    case 'text':
      return answer.text.trim() !== ''
    case 'ranking':
      return answer.order.length > 0
  }
}
