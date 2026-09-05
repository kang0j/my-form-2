import { describe, expect, it } from 'vitest'
import {
  hashBrowserKey,
  hashIp,
  hashUa,
  newId,
  newSurveyId,
} from '../../src/server/anonymity'

const SECRET = 'test-secret'

describe('newId', () => {
  it('매번 다른 UUID 를 만든다', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newId()))
    expect(ids.size).toBe(100)
    expect([...ids][0]).toMatch(/^[0-9a-f-]{36}$/)
  })

  // 글자 집합·길이만 보는 위 검사는 버전이 아닌 UUID(예: v1, nil UUID, 임의의
  // 36자 16진수+하이픈 문자열)도 통과시킨다. newId 는 crypto.randomUUID 를
  // 그대로 쓴다고 문서화(anonymity.ts 상단 주석)하고 있으므로, 실제로 v4
  // 형식(13번째 자리 4, 17번째 자리 8/9/a/b)인지까지 검사한다.
  it('버전(4)과 변이 니블을 갖춘 v4 UUID 다', () => {
    const ids = Array.from({ length: 100 }, () => newId())
    for (const id of ids) {
      expect(id[14]).toBe('4')
      expect(['8', '9', 'a', 'b']).toContain(id[19])
    }
  })
})

describe('newSurveyId', () => {
  it('대소문자·숫자 6자다', () => {
    for (const id of Array.from({ length: 200 }, () => newSurveyId())) {
      expect(id).toMatch(/^[A-Za-z0-9]{6}$/)
    }
  })

  it('매번 다른 값이 나온다', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newSurveyId()))
    expect(ids.size).toBe(500)
  })

  // 바이트를 그냥 % 62 하면 알파벳 앞쪽 8글자가 나머지보다 약 1.6배 자주
  // 나온다(256 = 62×4 + 8). 248 이상을 버리는 거부 표집이 실제로
  // 걸려 있는지, 글자별 빈도가 균등에서 크게 벗어나지 않는지로 확인한다.
  it('알파벳 앞쪽 글자로 치우치지 않는다', () => {
    const counts = new Map<string, number>()
    const samples = 4000
    for (const id of Array.from({ length: samples }, () => newSurveyId())) {
      for (const char of id) counts.set(char, (counts.get(char) ?? 0) + 1)
    }

    const expected = (samples * 6) / 62
    const head = 'ABCDEFGH'.split('').reduce((sum, c) => sum + (counts.get(c) ?? 0), 0) / 8
    const tail = '23456789'.split('').reduce((sum, c) => sum + (counts.get(c) ?? 0), 0) / 8

    // 편향이 있었다면 head/tail 비가 1.6 부근에 앉는다. 표본 잡음만 남으면
    // 둘 다 기댓값의 ±15% 안에 든다.
    expect(head).toBeGreaterThan(expected * 0.85)
    expect(head).toBeLessThan(expected * 1.15)
    expect(tail).toBeGreaterThan(expected * 0.85)
    expect(tail).toBeLessThan(expected * 1.15)
  })
})

describe('hashBrowserKey', () => {
  it('같은 설문·같은 키면 같은 값이다', async () => {
    const a = await hashBrowserKey(SECRET, 'key-1', 'survey-1')
    const b = await hashBrowserKey(SECRET, 'key-1', 'survey-1')
    expect(a).toBe(b)
  })

  it('같은 설문이라도 키가 다르면 값이 달라진다', async () => {
    const a = await hashBrowserKey(SECRET, 'key-1', 'survey-1')
    const b = await hashBrowserKey(SECRET, 'key-2', 'survey-1')
    expect(a).not.toBe(b)
  })

  it('설문이 다르면 값이 달라져 설문 간 연결이 끊긴다', async () => {
    const a = await hashBrowserKey(SECRET, 'key-1', 'survey-1')
    const b = await hashBrowserKey(SECRET, 'key-1', 'survey-2')
    expect(a).not.toBe(b)
  })

  it('원본 키를 담고 있지 않다', async () => {
    const hash = await hashBrowserKey(SECRET, 'key-1', 'survey-1')
    expect(hash).not.toContain('key-1')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('시크릿이 다르면 값이 달라진다', async () => {
    const a = await hashBrowserKey(SECRET, 'key-1', 'survey-1')
    const b = await hashBrowserKey('other-secret', 'key-1', 'survey-1')
    expect(a).not.toBe(b)
  })
})

describe('용도별 해시 분리', () => {
  it('같은 입력이라도 용도가 다르면 값이 다르다', async () => {
    const ip = await hashIp(SECRET, 'same')
    const ua = await hashUa(SECRET, 'same')
    expect(ip).not.toBe(ua)
  })
})
