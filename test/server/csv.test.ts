import { describe, expect, it } from 'vitest'
import type { SurveyDef } from '../../src/shared/schema'
import type { AnswerRow } from '../../src/server/aggregate'
import { buildResponsesCsv, buildRosterCsv, toCsv } from '../../src/server/csv'

describe('toCsv', () => {
  it('쉼표가 든 값을 따옴표로 감싼다', () => {
    expect(toCsv([['a,b', 'c']])).toContain('"a,b",c')
  })

  it('따옴표를 두 번 겹쳐 이스케이프한다', () => {
    expect(toCsv([['그는 "안녕"이라 했다']])).toContain('"그는 ""안녕""이라 했다"')
  })

  it('줄바꿈이 든 값을 따옴표로 감싼다', () => {
    expect(toCsv([['첫 줄\n둘째 줄']])).toContain('"첫 줄\n둘째 줄"')
  })

  it('엑셀이 한글을 읽도록 BOM 을 붙인다', () => {
    expect(toCsv([['가']]).startsWith('\uFEFF')).toBe(true)
  })

  it('수식으로 해석될 값 앞에 작은따옴표를 붙여 무력화한다', () => {
    expect(toCsv([['=1+1']])).toContain(`'=1+1`)
    expect(toCsv([['@SUM(A1)']])).toContain(`'@SUM(A1)`)
    expect(toCsv([['+1']])).toContain(`'+1`)
    expect(toCsv([['-1']])).toContain(`'-1`)
    expect(toCsv([['=HYPERLINK("http://evil","click")']])).toContain(`'=HYPERLINK`)
  })

  it('수식 앞에 공백이 있어도 무력화한다', () => {
    // 일부 스프레드시트 리더는 셀 값을 열 때 앞뒤 공백을 잘라내고 나서
    // 수식 여부를 판단하므로, 맨 앞 글자만 보면 " =1+1" 같은 값이 새어나간다.
    const csv = toCsv([[' =1+1']])
    const [cell] = csv.replace(/^﻿/, '').split('\r\n')
    expect(cell).toBe(`' =1+1`)
  })

  it('일반 값과 한글은 그대로 둔다', () => {
    expect(toCsv([['홍길동']])).toContain('홍길동')
    expect(toCsv([['20250001']])).toContain('20250001')
  })
})

const survey: SurveyDef = {
  id: 's1',
  title: '설문',
  description: '',
  status: 'closed',
  resultsVisibility: 'after_close',
  closeAt: null,
  sections: [{ id: 'sec1', questions: [
    {
      id: 'q1',
      type: 'multi',
      title: '좋아하는 것',
      description: '',
      required: false,
      minSelect: null,
      maxSelect: null,
      allowOther: true,
      options: [
        { id: 'o1', label: '사과', isOther: false },
        { id: 'o2', label: '기타', isOther: true },
      ],
      rules: [],
    },
    {
      id: 'q2',
      type: 'ranking',
      title: '순위',
      description: '',
      required: false,
      minSelect: null,
      maxSelect: null,
      allowOther: false,
      options: [
        { id: 'r1', label: '가', isOther: false },
        { id: 'r2', label: '나', isOther: false },
      ],
      rules: [],
    },
    {
      id: 'q3',
      type: 'text',
      title: '한마디',
      description: '',
      required: false,
      minSelect: null,
      maxSelect: null,
      allowOther: false,
      options: [],
      rules: [],
    },
  ] }],
}

function row(p: Partial<AnswerRow> & { submissionId: string; questionId: string }): AnswerRow {
  return { optionId: null, textValue: null, rankPosition: null, ...p }
}

describe('buildResponsesCsv', () => {
  it('첫 줄에 문항 제목을 넣는다', () => {
    const csv = buildResponsesCsv(survey, [])
    expect(csv.split('\r\n')[0]).toBe('\uFEFF응답 ID,좋아하는 것,순위,한마디')
  })

  it('제출 하나를 한 줄로 만든다', () => {
    const csv = buildResponsesCsv(survey, [
      row({ submissionId: 'sub-1', questionId: 'q1', optionId: 'o1' }),
      row({ submissionId: 'sub-1', questionId: 'q1', optionId: 'o2', textValue: '포도' }),
      row({ submissionId: 'sub-1', questionId: 'q2', optionId: 'r2', rankPosition: 1 }),
      row({ submissionId: 'sub-1', questionId: 'q2', optionId: 'r1', rankPosition: 2 }),
      row({ submissionId: 'sub-1', questionId: 'q3', textValue: '좋아요' }),
    ])

    const lines = csv.split('\r\n')
    expect(lines).toHaveLength(3) // 헤더 + 한 줄 + 마지막 빈 줄
    expect(lines[1]).toContain('사과 | 기타(포도)')
    expect(lines[1]).toContain('1. 나 | 2. 가')
    expect(lines[1]).toContain('좋아요')
  })

  it('제출을 ID 순으로 내보낸다', () => {
    const csv = buildResponsesCsv(survey, [
      row({ submissionId: 'sub-b', questionId: 'q3', textValue: 'B' }),
      row({ submissionId: 'sub-a', questionId: 'q3', textValue: 'A' }),
    ])
    const lines = csv.split('\r\n')
    expect(lines[1]).toContain('sub-a')
    expect(lines[2]).toContain('sub-b')
  })
})

describe('buildRosterCsv', () => {
  it('명부를 사람이 읽을 수 있는 시각과 함께 내보낸다', () => {
    const csv = buildRosterCsv([
      {
        id: 'p1',
        name: '홍길동',
        studentId: '20250001',
        submittedAt: Date.UTC(2026, 8, 2, 1, 0),
        ipHash: 'iphash',
        uaHash: 'uahash',
      },
    ])

    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('\uFEFF이름,학번,제출 시각(KST),IP 해시,UA 해시')
    expect(lines[1]).toBe('홍길동,20250001,2026-09-02 10:00,iphash,uahash')
  })
})
