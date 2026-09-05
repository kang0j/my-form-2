import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { QuestionDef } from '../../src/shared/schema'
import { ChoiceQuestion } from '../../src/client/vote/ChoiceQuestion'
import { TextQuestion } from '../../src/client/vote/TextQuestion'

const singleQ: QuestionDef = {
  id: 'q1',
  type: 'single',
  title: '누구를 지지하십니까?',
  description: '한 명만 고르세요',
  required: true,
  minSelect: null,
  maxSelect: null,
  allowOther: false,
  options: [
    { id: 'o1', label: '후보 A', isOther: false },
    { id: 'o2', label: '후보 B', isOther: false },
  ],
  rules: [],
}

const multiQ: QuestionDef = {
  ...singleQ,
  id: 'q2',
  type: 'multi',
  title: '관심 분야',
  description: '',
  required: false,
  minSelect: 1,
  maxSelect: 2,
  allowOther: true,
  options: [
    { id: 'o3', label: '개발', isOther: false },
    { id: 'o4', label: '기타', isOther: true },
  ],
}

const textQ: QuestionDef = {
  ...singleQ,
  id: 'q3',
  type: 'text',
  title: '하고 싶은 말',
  description: '',
  required: false,
  options: [],
}

function renderChoice(question: QuestionDef, overrides = {}) {
  const props = {
    question,
    selectedSingle: '',
    selectedMulti: [] as string[],
    otherText: '',
    onChangeSingle: vi.fn(),
    onChangeMulti: vi.fn(),
    onChangeOther: vi.fn(),
    ...overrides,
  }
  render(<ChoiceQuestion {...props} />)
  return props
}

describe('ChoiceQuestion', () => {
  it('제목과 설명, 보기를 보여준다', () => {
    renderChoice(singleQ)
    expect(screen.getByText(/누구를 지지하십니까\?/)).toBeInTheDocument()
    expect(screen.getByText('한 명만 고르세요')).toBeInTheDocument()
    expect(screen.getByLabelText('후보 A')).toBeInTheDocument()
  })

  it('필수 문항에 표시를 붙인다', () => {
    renderChoice(singleQ)
    expect(screen.getByText('필수')).toBeInTheDocument()
  })

  // 번호는 label 안에 CSS 로 찍힌다 — 숫자를 눌러도 그 보기가 골라져야
  // 하고, 그러면서 보기의 접근 가능한 이름은 글자 그대로여야 한다.
  it('보기 번호가 label 안에 있어 눌러도 골라진다', () => {
    const onChangeSingle = vi.fn()
    render(
      <ChoiceQuestion
        question={singleQ}
        selectedSingle=""
        selectedMulti={[]}
        otherText=""
        onChangeSingle={onChangeSingle}
        onChangeMulti={vi.fn()}
        onChangeOther={vi.fn()}
      />,
    )

    const input = screen.getByLabelText('후보 A')
    expect(input.closest('label')).not.toBeNull()
    // 번호 자리를 눌러도 label 안이므로 그 보기가 골라진다.
    fireEvent.click(input.closest('label')!)
    expect(onChangeSingle).toHaveBeenCalledWith(singleQ.options[0].id)
  })

  it('단일 선택은 라디오다', () => {
    renderChoice(singleQ)
    expect(screen.getByLabelText('후보 A')).toHaveAttribute('type', 'radio')
  })

  it('단일 선택을 알린다', async () => {
    const props = renderChoice(singleQ)
    await userEvent.click(screen.getByLabelText('후보 B'))
    expect(props.onChangeSingle).toHaveBeenCalledWith('o2')
  })

  it('다중 선택은 체크박스다', () => {
    renderChoice(multiQ)
    expect(screen.getByLabelText('개발')).toHaveAttribute('type', 'checkbox')
  })

  it('다중 선택을 토글해서 알린다', async () => {
    const props = renderChoice(multiQ, { selectedMulti: ['o3'] })
    await userEvent.click(screen.getByLabelText('기타'))
    expect(props.onChangeMulti).toHaveBeenCalledWith(['o3', 'o4'])

    await userEvent.click(screen.getByLabelText('개발'))
    expect(props.onChangeMulti).toHaveBeenCalledWith([])
  })

  it('개수 제한을 안내한다', () => {
    renderChoice(multiQ)
    expect(screen.getByText('최소 1개, 최대 2개 고를 수 있어요')).toBeInTheDocument()
  })

  it('최소 개수만 있으면 최소만 안내한다', () => {
    renderChoice({ ...multiQ, minSelect: 1, maxSelect: null })
    expect(screen.getByText('최소 1개 골라야 해요')).toBeInTheDocument()
  })

  it('최대 개수만 있으면 최대만 안내한다', () => {
    renderChoice({ ...multiQ, minSelect: null, maxSelect: 2 })
    expect(screen.getByText('최대 2개까지 고를 수 있어요')).toBeInTheDocument()
  })

  it('기타를 고르면 입력칸이 나타난다', () => {
    renderChoice(multiQ, { selectedMulti: ['o4'] })
    expect(screen.getByLabelText('기타 내용')).toBeInTheDocument()
  })

  it('기타를 고르지 않으면 입력칸이 없다', () => {
    renderChoice(multiQ, { selectedMulti: ['o3'] })
    expect(screen.queryByLabelText('기타 내용')).not.toBeInTheDocument()
  })
})

describe('TextQuestion', () => {
  it('입력을 알린다', async () => {
    const onChange = vi.fn()
    render(<TextQuestion question={textQ} value="" onChange={onChange} />)

    await userEvent.type(screen.getByLabelText('하고 싶은 말'), '좋')
    expect(onChange).toHaveBeenCalledWith('좋')
  })

  it('필수가 아니면 필수 표시를 보여주지 않는다', () => {
    render(<TextQuestion question={{ ...textQ, required: false }} value="" onChange={vi.fn()} />)
    expect(screen.queryByText('필수')).not.toBeInTheDocument()
  })
})
