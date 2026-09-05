import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/client/App'

describe('App', () => {
  it('첫 화면은 익명성이 성립하는 방식을 보여주고, 들어가는 길을 말한다', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByText('AN-FORM')).toBeInTheDocument()

    // 이 화면의 본체는 도해다 — 문구가 아니라 그림이 익명성을 말한다
    // (PRODUCT.md: "믿음은 문구가 아니라 구조에서 나와야 한다").
    expect(container.querySelector('.principle__stage')).not.toBeNull()

    // 설문 목록이 없는 주소라, 들어가는 길을 반드시 말해야 한다.
    expect(screen.getByText(/Open the link you were sent/)).toBeInTheDocument()
  })

  it('첫 화면의 도해는 그 화면의 언어로 열 이름을 단다', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    // 같은 도해를 투표 흐름과 공유하지만 그쪽은 한국어다(PRODUCT.md §제약).
    // 열 이름이 props 로 빠져 있지 않으면 한쪽 언어가 다른 쪽에 새어 나온다.
    expect(screen.getByText('Roster')).toBeInTheDocument()
    expect(screen.getByText('Answers')).toBeInTheDocument()
    expect(screen.queryByText('참가자 명단')).toBeNull()
  })

  it('첫 화면은 문서 언어를 영어로 두고, 벗어나면 한국어로 되돌린다', () => {
    // 영어 문장이 lang="ko" 문서에 실리면 스크린리더가 한국어 음성 엔진으로
    // 읽는다. 되돌리지 않으면 반대로 투표 화면의 한국어가 영어로 선언된다.
    const { unmount } = render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )
    expect(document.documentElement.lang).toBe('en')

    unmount()
    expect(document.documentElement.lang).toBe('ko')
  })

  it('모르는 경로에는 안내를 보여준다', () => {
    render(
      <MemoryRouter initialEntries={['/이상한/경로']}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByText('페이지를 찾지 못했어요.')).toBeInTheDocument()
  })
})
