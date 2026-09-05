import type { CSSProperties } from 'react'
import type { QuestionDef } from '../../shared/schema'

type Props = {
  question: QuestionDef
  value: string
  onChange: (value: string) => void
}

export function TextQuestion({ question, value, onChange }: Props) {
  return (
    <fieldset>
      <legend
        className="question-screen__title enter-item"
        style={{ '--enter-index': 0 } as CSSProperties}
      >
        {question.title}
        {question.required && <span className="question-screen__required">필수</span>}
      </legend>
      {question.description && (
        <p
          className="question-screen__description enter-item"
          style={{ '--enter-index': 1 } as CSSProperties}
        >
          {question.description}
        </p>
      )}

      {/* 시각적으로는 legend 가 제목 역할을 하므로 label 은 스크린리더 전용으로 남긴다. */}
      <label className="sr-only" htmlFor={question.id}>
        {question.title}
      </label>
      <textarea
        id={question.id}
        className="answer-textarea enter-item"
        style={{ '--enter-index': 2 } as CSSProperties}
        rows={4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </fieldset>
  )
}
