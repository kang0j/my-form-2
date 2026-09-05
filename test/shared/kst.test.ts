import { describe, expect, it } from 'vitest'
import { formatKst, fromKstInput, toKstInput } from '../../src/shared/kst'

describe('KST 한 시계', () => {
  const nineAmKst = Date.parse('2026-09-10T09:00:00+09:00')

  it('입력칸 값을 KST 로 읽는다 — 기기 시간대와 무관하다', () => {
    expect(fromKstInput('2026-09-10T09:00')).toBe(nineAmKst)
    // 같은 문자열을 new Date() 에 맡기면 기기 시간대로 읽혀 달라진다.
    // 이 검사는 그 차이에 기대지 않고 절대 시각 하나만 못 박는다.
    expect(fromKstInput('2026-09-10T09:00')).toBe(Date.UTC(2026, 8, 10, 0, 0))
  })

  it('빈 칸과 형식이 아닌 값은 null 이다', () => {
    expect(fromKstInput('')).toBeNull()
    expect(fromKstInput('   ')).toBeNull()
    expect(fromKstInput('내일 아홉시')).toBeNull()
  })

  it('절대 시각을 입력칸 값으로 되돌린다', () => {
    expect(toKstInput(nineAmKst)).toBe('2026-09-10T09:00')
    expect(toKstInput(null)).toBe('')
  })

  it('왕복해도 같은 시각이다', () => {
    expect(fromKstInput(toKstInput(nineAmKst))).toBe(nineAmKst)
  })

  it('표에 적는 모양은 KST 의 날짜와 분이다', () => {
    expect(formatKst(nineAmKst)).toBe('2026-09-10 09:00')
    // UTC 자정은 KST 아침 아홉시다 — 날짜가 넘어간다.
    expect(formatKst(Date.UTC(2026, 8, 9, 16, 30))).toBe('2026-09-10 01:30')
  })
})
