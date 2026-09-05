import { describe, expect, it } from 'vitest'
import { identityKey, normalizeIdentity, sameIdentity } from '../../src/shared/identity'

describe('normalizeIdentity', () => {
  it('앞뒤 공백을 지운다', () => {
    expect(normalizeIdentity('  홍길동  ', ' 20250001 ')).toEqual({
      name: '홍길동',
      studentId: '20250001',
    })
  })

  // 손으로 옮겨 적은 명부에는 「홍 길동」처럼 가운데 공백이 섞여 들어온다.
  // 그걸 다른 사람으로 보면 허용 명단에 있는 사람이 문 앞에서 막힌다.
  it('가운데 연속 공백을 한 칸으로 줄인다', () => {
    expect(normalizeIdentity('홍  길동', '2025  0001').name).toBe('홍 길동')
    expect(normalizeIdentity('홍  길동', '2025  0001').studentId).toBe('2025 0001')
  })

  it('탭·개행도 공백으로 본다', () => {
    expect(normalizeIdentity('홍\t길동', '2025\n0001').name).toBe('홍 길동')
    expect(normalizeIdentity('홍\t길동', '2025\n0001').studentId).toBe('2025 0001')
  })

  // macOS 에서 만든 CSV 는 한글을 NFD(자모 분리)로 담아 오는 일이 흔하다.
  // 눈에는 같은 「홍길동」이지만 코드포인트가 달라 문자열 비교가 어긋난다.
  it('유니코드를 NFC 로 모은다', () => {
    const nfd = '홍길동'.normalize('NFD')
    expect(nfd).not.toBe('홍길동')
    expect(normalizeIdentity(nfd, '20250001').name).toBe('홍길동')
  })
})

describe('sameIdentity', () => {
  it('정규화하면 같아지는 두 신원을 같다고 본다', () => {
    expect(
      sameIdentity({ name: ' 홍  길동 ', studentId: '20250001' }, { name: '홍 길동', studentId: '20250001' }),
    ).toBe(true)
  })

  it('학번이 다르면 다른 사람이다', () => {
    expect(
      sameIdentity({ name: '홍길동', studentId: '20250001' }, { name: '홍길동', studentId: '20250002' }),
    ).toBe(false)
  })

  // 동명이인은 학번으로만 갈린다. 이름만 같다고 같은 사람으로 묶으면
  // 한 명이 다른 사람의 자리를 막는다.
  it('이름이 다르면 다른 사람이다', () => {
    expect(
      sameIdentity({ name: '홍길동', studentId: '20250001' }, { name: '김서연', studentId: '20250001' }),
    ).toBe(false)
  })
})

describe('identityKey', () => {
  it('정규화하면 같아지는 두 신원은 같은 키를 낸다', () => {
    expect(identityKey({ name: ' 홍  길동 ', studentId: '20250001' })).toBe(
      identityKey({ name: '홍 길동', studentId: '20250001' }),
    )
  })

  // 이름과 학번을 공백으로 이으면 「홍 길」+「동 1」과 「홍」+「길 동 1」이
  // 같은 키가 된다 — 명부에 없는 사람이 명단에 있는 사람 행세를 할 수 있다.
  // 이름·학번 어느 쪽에도 들어올 수 없는 문자로 갈라야 한다.
  it('이름과 학번의 경계가 밀려도 키가 겹치지 않는다', () => {
    expect(identityKey({ name: '홍 길', studentId: '동 1' })).not.toBe(
      identityKey({ name: '홍', studentId: '길 동 1' }),
    )
  })
})
