import { describe, expect, it } from 'vitest'
import { formatAllowlistText, parseAllowlistText } from '../../src/client/admin/allowlistText'

describe('parseAllowlistText', () => {
  it('한 줄에 이름과 학번을 읽는다', () => {
    expect(parseAllowlistText('홍길동,20250001')).toEqual({
      entries: [{ name: '홍길동', studentId: '20250001' }],
      problems: [],
    })
  })

  // 관리자는 엑셀에서 복사(탭), 메모장에서 복사(공백), 손으로 타이핑(쉼표)
  // 셋 중 무엇이든 한다. 어느 쪽인지 물어보지 않고 다 받는다.
  it('쉼표·탭·공백 어느 것으로 나눠도 읽는다', () => {
    const parsed = parseAllowlistText('홍길동,20250001\n김서연\t20250002\n박도현 20250003')
    expect(parsed.entries).toEqual([
      { name: '홍길동', studentId: '20250001' },
      { name: '김서연', studentId: '20250002' },
      { name: '박도현', studentId: '20250003' },
    ])
  })

  it('빈 줄과 앞뒤 공백을 무시한다', () => {
    const parsed = parseAllowlistText('\n  홍길동, 20250001  \n\n   \n')
    expect(parsed.entries).toEqual([{ name: '홍길동', studentId: '20250001' }])
    expect(parsed.problems).toEqual([])
  })

  it('CRLF 개행을 읽는다', () => {
    const parsed = parseAllowlistText('홍길동,20250001\r\n김서연,20250002')
    expect(parsed.entries).toHaveLength(2)
  })

  // 이름에 공백이 든 사람(「홍 길동」)은 공백 구분과 부딪힌다. 학번이 늘
  // 마지막 칸이라는 점을 이용해 마지막 구분자에서 가른다.
  it('이름에 공백이 있으면 마지막 칸을 학번으로 본다', () => {
    expect(parseAllowlistText('홍 길동 20250001').entries).toEqual([
      { name: '홍 길동', studentId: '20250001' },
    ])
  })

  it('신원을 정규화해서 담는다', () => {
    expect(parseAllowlistText(`${'홍길동'.normalize('NFD')},20250001`).entries).toEqual([
      { name: '홍길동', studentId: '20250001' },
    ])
  })

  // 조용히 버리면 관리자는 30명을 넣었다고 믿는데 29명만 들어간다.
  // 그 한 명은 투표 당일 문 앞에서야 알게 된다.
  it('칸이 하나뿐인 줄을 줄 번호와 함께 짚는다', () => {
    const parsed = parseAllowlistText('홍길동,20250001\n김서연')
    expect(parsed.problems).toEqual(['2번째 줄: 이름과 학번을 함께 적어 주세요. — 「김서연」'])
  })

  it('문제가 있어도 나머지 줄은 그대로 읽어 둔다', () => {
    const parsed = parseAllowlistText('홍길동,20250001\n김서연')
    expect(parsed.entries).toEqual([{ name: '홍길동', studentId: '20250001' }])
  })

  it('같은 사람이 두 줄이면 하나로 접는다', () => {
    const parsed = parseAllowlistText('홍길동,20250001\n 홍길동 , 20250001 ')
    expect(parsed.entries).toEqual([{ name: '홍길동', studentId: '20250001' }])
    expect(parsed.problems).toEqual([])
  })

  it('빈 텍스트는 빈 명단이다', () => {
    expect(parseAllowlistText('   \n  ')).toEqual({ entries: [], problems: [] })
  })
})

describe('formatAllowlistText', () => {
  it('저장된 명단을 다시 편집할 수 있는 텍스트로 되돌린다', () => {
    const text = formatAllowlistText([
      { name: '홍길동', studentId: '20250001' },
      { name: '김서연', studentId: '20250002' },
    ])
    expect(text).toBe('홍길동,20250001\n김서연,20250002')
  })

  // 되돌린 텍스트를 다시 읽으면 같은 명단이 나와야 한다 — 아니면 화면을
  // 열었다 저장하기만 해도 명단이 조금씩 달라진다.
  it('되읽으면 같은 명단이 나온다', () => {
    const entries = [
      { name: '홍 길동', studentId: '20250001' },
      { name: '김서연', studentId: 'A20250002' },
    ]
    expect(parseAllowlistText(formatAllowlistText(entries)).entries).toEqual(entries)
  })
})
