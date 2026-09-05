import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { QuestionDef } from '../../src/shared/schema'
import { RankingQuestion } from '../../src/client/vote/RankingQuestion'

const question: QuestionDef = {
  id: 'q1',
  type: 'ranking',
  title: '선호 순위',
  description: '드래그하거나 버튼으로 순서를 바꾸세요',
  required: true,
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

describe('RankingQuestion', () => {
  it('현재 순서대로 순위와 이름을 보여준다', () => {
    render(<RankingQuestion question={question} order={['r2', 'r1', 'r3']} onChange={vi.fn()} />)

    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('1')
    expect(items[0]).toHaveTextContent('나')
    expect(items[1]).toHaveTextContent('가')
    expect(items[2]).toHaveTextContent('다')
  })

  it('위로 버튼이 순서를 바꾼다', async () => {
    const onChange = vi.fn()
    render(<RankingQuestion question={question} order={['r1', 'r2', 'r3']} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: '나 위로' }))
    expect(onChange).toHaveBeenCalledWith(['r2', 'r1', 'r3'])
  })

  it('아래로 버튼이 순서를 바꾼다', async () => {
    const onChange = vi.fn()
    render(<RankingQuestion question={question} order={['r1', 'r2', 'r3']} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: '가 아래로' }))
    expect(onChange).toHaveBeenCalledWith(['r2', 'r1', 'r3'])
  })

  it('맨 위 항목의 위로 버튼은 비활성이다', () => {
    render(<RankingQuestion question={question} order={['r1', 'r2', 'r3']} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: '가 위로' })).toBeDisabled()
  })

  it('맨 아래 항목의 아래로 버튼은 비활성이다', () => {
    render(<RankingQuestion question={question} order={['r1', 'r2', 'r3']} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: '다 아래로' })).toBeDisabled()
  })

  it('필수 표시를 보여준다', () => {
    render(<RankingQuestion question={question} order={['r1', 'r2', 'r3']} onChange={vi.fn()} />)
    expect(screen.getByText('필수')).toBeInTheDocument()
  })

  it('유니코드 글리프를 아이콘 대용으로 쓰지 않는다', () => {
    const { container } = render(
      <RankingQuestion question={question} order={['r1', 'r2', 'r3']} onChange={vi.fn()} />,
    )
    expect(container).not.toHaveTextContent('⠿')
    expect(container).not.toHaveTextContent('↑')
    expect(container).not.toHaveTextContent('↓')
    expect(screen.getByRole('button', { name: '가 위로' })).toHaveTextContent('위로')
    expect(screen.getByRole('button', { name: '가 아래로' })).toHaveTextContent('아래로')
  })

  it('드래그 손잡이(순위 숫자)는 스크린리더에서 숨겨지지 않고 실제 이름을 갖는다', () => {
    render(<RankingQuestion question={question} order={['r1', 'r2', 'r3']} onChange={vi.fn()} />)
    const handle = screen.getByRole('button', { name: '가 끌어서 순서 바꾸기, 지금 1번째예요' })
    expect(handle).not.toHaveAttribute('aria-hidden')
    expect(handle).toHaveTextContent('1')
  })
})
