import type { CSSProperties } from 'react'
import type { QuestionDef } from '../../shared/schema'
import { toggleMulti } from './draft'

type Props = {
  question: QuestionDef
  selectedSingle: string
  selectedMulti: string[]
  otherText: string
  onChangeSingle: (optionId: string) => void
  onChangeMulti: (optionIds: string[]) => void
  onChangeOther: (text: string) => void
}

function selectionHint(question: QuestionDef): string | null {
  if (question.type !== 'multi') return null
  const { minSelect, maxSelect } = question
  if (minSelect !== null && maxSelect !== null) return `최소 ${minSelect}개, 최대 ${maxSelect}개 고를 수 있어요`
  if (minSelect !== null) return `최소 ${minSelect}개 골라야 해요`
  if (maxSelect !== null) return `최대 ${maxSelect}개까지 고를 수 있어요`
  return null
}

/**
 * 보기는 카드가 아니라 목록의 한 줄이다. 선택 표시는 아이콘이 아니라
 * 타이포그래피 자체 — 고른 항목은 굵기·불투명도가 오르고 나머지는 내려간다.
 * 실제 input 은 접근성 트리와 키보드를 위해 그대로 남긴다(시각적으로만 숨김).
 */
export function ChoiceQuestion({
  question,
  selectedSingle,
  selectedMulti,
  otherText,
  onChangeSingle,
  onChangeMulti,
  onChangeOther,
}: Props) {
  const isMulti = question.type === 'multi'
  const selectedIds = isMulti ? selectedMulti : selectedSingle ? [selectedSingle] : []
  const otherPicked = question.options.some((o) => o.isOther && selectedIds.includes(o.id))
  const hint = selectionHint(question)

  return (
    <fieldset>
      <legend className="question-screen__title enter-item" style={{ '--enter-index': 0 } as CSSProperties}>
        {question.title}
        {question.required && <span className="question-screen__required">필수</span>}
      </legend>
      {question.description && (
        <p className="question-screen__description enter-item" style={{ '--enter-index': 1 } as CSSProperties}>
          {question.description}
        </p>
      )}
      {hint && (
        <p className="question-screen__hint enter-item" style={{ '--enter-index': 1 } as CSSProperties}>
          {hint}
        </p>
      )}

      <ol className="option-list">
        {question.options.map((option, index) => {
          const selected = selectedIds.includes(option.id)
          return (
            <li
              key={option.id}
              className={`option-row enter-item${selected ? ' option-row--selected' : ''}`}
              style={{ '--enter-index': index + 2 } as CSSProperties}
            >
              {/* 번호는 CSS 카운터로 label 안에 찍는다(§.option-row__control
                  ::before). 손가락이 닿는 자리가 곧 고르는 자리여야 하는데,
                  글자로 넣으면 그 숫자가 보기의 접근 가능한 이름에 섞여
                  「1 후보 A」가 된다. */}
              <label className="option-row__control" htmlFor={option.id}>
                <input
                  id={option.id}
                  className="option-row__input"
                  type={isMulti ? 'checkbox' : 'radio'}
                  name={question.id}
                  checked={selected}
                  onChange={() =>
                    isMulti
                      ? onChangeMulti(toggleMulti(selectedMulti, option.id))
                      : onChangeSingle(option.id)
                  }
                />
                <span className="option-row__label">{option.label}</span>
              </label>
            </li>
          )
        })}
      </ol>

      {otherPicked && (
        <div className="other-field enter-item" style={{ '--enter-index': question.options.length + 2 } as CSSProperties}>
          <label className="field__label" htmlFor={`${question.id}-other`}>
            기타 내용
          </label>
          <input
            id={`${question.id}-other`}
            className="field__input"
            type="text"
            value={otherText}
            onChange={(e) => onChangeOther(e.target.value)}
          />
        </div>
      )}
    </fieldset>
  )
}
