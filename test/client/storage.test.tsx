import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearDraft,
  clearSubmitted,
  createUuid,
  getBrowserKey,
  hasSubmitted,
  loadDraft,
  markSubmitted,
  rememberSubmittedIds,
  saveDraft,
  submittedIds,
} from '../../src/client/storage'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getBrowserKey', () => {
  it('처음 부르면 만들어 저장한다', () => {
    const key = getBrowserKey()
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
    expect(localStorage.getItem('anonymous-vote:browser-key')).toBe(key)
  })

  it('두 번째부터는 같은 값을 돌려준다', () => {
    expect(getBrowserKey()).toBe(getBrowserKey())
  })
})

describe('createUuid', () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

  it('crypto.randomUUID 가 있으면 그걸 쓴다', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'fixed-uuid-from-native' })
    expect(createUuid()).toBe('fixed-uuid-from-native')
  })

  it('randomUUID 가 없어도 getRandomValues 가 있으면 v4 UUID 를 조립한다 (구형 WebView)', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint8Array) => {
        arr.fill(0xab)
        return arr
      },
    })
    const id = createUuid()
    expect(id).toMatch(UUID_V4)
  })

  it('crypto 자체가 없으면 Math.random 으로 만들어낸다 (최후의 수단)', () => {
    vi.stubGlobal('crypto', undefined)
    const id = createUuid()
    expect(id).toMatch(UUID_V4)
  })

  it('randomUUID 가 던지면 getRandomValues 로 내려간다', () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => {
        throw new Error('not available')
      },
      getRandomValues: (arr: Uint8Array) => {
        arr.fill(0x11)
        return arr
      },
    })
    expect(createUuid()).toMatch(UUID_V4)
  })
})

describe('임시 저장', () => {
  it('설문별로 저장하고 읽는다', () => {
    saveDraft('s1', { name: '홍길동' })
    saveDraft('s2', { name: '김철수' })

    expect(loadDraft<{ name: string }>('s1')).toEqual({ name: '홍길동' })
    expect(loadDraft<{ name: string }>('s2')).toEqual({ name: '김철수' })
  })

  it('없으면 null 이다', () => {
    expect(loadDraft('없는설문')).toBeNull()
  })

  it('깨진 값이 들어 있으면 null 이다', () => {
    localStorage.setItem('anonymous-vote:draft:s1', '{깨진 JSON')
    expect(loadDraft('s1')).toBeNull()
  })

  it('지울 수 있다', () => {
    saveDraft('s1', { name: '홍길동' })
    clearDraft('s1')
    expect(loadDraft('s1')).toBeNull()
  })
})

describe('localStorage 자체가 막혀 있을 때 (시크릿 창·사이트 데이터 차단)', () => {
  // §PRODUCT: 공용 노트북·구형 WebView 를 전제로 하는 이 앱의 실제 사용
  // 조건이다. 위 '깨진 JSON' 테스트는 localStorage.getItem 은 성공하되
  // JSON.parse 가 던지는 경우만 잡는다 — getItem/setItem/removeItem 자체가
  // 던지는 경우(시크릿 창, 사이트 데이터 차단 브라우저 설정)는 storage.ts
  // 의 다른 catch 분기라 별도로 확인해야 한다.
  function stubThrowingLocalStorage() {
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    vi.stubGlobal('localStorage', throwing)
  }

  it('saveDraft 는 예외를 밖으로 던지지 않는다', () => {
    stubThrowingLocalStorage()
    expect(() => saveDraft('s1', { name: '홍길동' })).not.toThrow()
  })

  it('loadDraft 는 null 로 낮춘다', () => {
    stubThrowingLocalStorage()
    expect(loadDraft('s1')).toBeNull()
  })

  it('clearDraft 는 예외를 밖으로 던지지 않는다', () => {
    stubThrowingLocalStorage()
    expect(() => clearDraft('s1')).not.toThrow()
  })

  it('hasSubmitted 는 false 로 낮춘다', () => {
    stubThrowingLocalStorage()
    expect(hasSubmitted('s1')).toBe(false)
  })

  it('markSubmitted 는 예외를 밖으로 던지지 않는다', () => {
    stubThrowingLocalStorage()
    expect(() => markSubmitted('s1')).not.toThrow()
  })

  it('clearSubmitted 는 예외를 밖으로 던지지 않는다', () => {
    stubThrowingLocalStorage()
    expect(() => clearSubmitted('s1')).not.toThrow()
  })

  it('submittedIds 는 빈 목록으로 낮춘다', () => {
    stubThrowingLocalStorage()
    expect(submittedIds('s1')).toEqual([])
  })

  it('rememberSubmittedIds 는 예외를 밖으로 던지지 않는다', () => {
    stubThrowingLocalStorage()
    expect(() => rememberSubmittedIds('s1', ['sub-1'])).not.toThrow()
  })

  it('getBrowserKey 는 매번 새 키를 만들어서라도 값을 돌려준다', () => {
    stubThrowingLocalStorage()
    const key = getBrowserKey()
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
    // 저장이 막혀 있으니 두 번째 호출도 새 키다 — 그래도 값 자체는 항상 나온다.
    expect(getBrowserKey()).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('제출 표시', () => {
  it('표시하기 전에는 false 다', () => {
    expect(hasSubmitted('s1')).toBe(false)
  })

  it('표시하면 true 다', () => {
    markSubmitted('s1')
    expect(hasSubmitted('s1')).toBe(true)
  })

  it('다른 설문에는 영향이 없다', () => {
    markSubmitted('s1')
    expect(hasSubmitted('s2')).toBe(false)
  })

  it('추가 제출을 위해 표시를 지울 수 있다', () => {
    markSubmitted('s1')
    clearSubmitted('s1')
    expect(hasSubmitted('s1')).toBe(false)
  })
})

describe('응답 ID (영수증)', () => {
  it('제출할 때 함께 적어 둔다', () => {
    markSubmitted('s1', 'sub-1')
    expect(submittedIds('s1')).toEqual(['sub-1'])
  })

  it('설문마다 따로 적힌다', () => {
    markSubmitted('s1', 'sub-1')
    markSubmitted('s2', 'sub-2')
    expect(submittedIds('s1')).toEqual(['sub-1'])
    expect(submittedIds('s2')).toEqual(['sub-2'])
  })

  it('낸 적이 없으면 빈 목록이다', () => {
    expect(submittedIds('s1')).toEqual([])
  })

  // 이 기능이 생기기 전의 표시는 '1' 한 글자였다. 그 기기는 "냈다"는 사실은
  // 남아 있지만 번호는 모르는 상태이고, 그때만 서버에 되묻는다(§/receipts).
  it("옛 표시('1')는 냈다고는 하되 번호는 없다", () => {
    localStorage.setItem('anonymous-vote:submitted:s1', '1')
    expect(hasSubmitted('s1')).toBe(true)
    expect(submittedIds('s1')).toEqual([])
  })

  it('되살린 목록을 적어 두면 다음부터는 그대로 읽힌다', () => {
    localStorage.setItem('anonymous-vote:submitted:s1', '1')
    rememberSubmittedIds('s1', ['sub-1', 'sub-2'])
    expect(submittedIds('s1')).toEqual(['sub-1', 'sub-2'])
  })

  it('ID 없이 표시해도 냈다는 사실은 남는다', () => {
    markSubmitted('s1')
    expect(hasSubmitted('s1')).toBe(true)
    expect(submittedIds('s1')).toEqual([])
  })

  it('깨진 값이 들어 있어도 빈 목록으로 낮춘다', () => {
    localStorage.setItem('anonymous-vote:submitted:s1', '{깨진 JSON')
    expect(submittedIds('s1')).toEqual([])
  })

  it('추가 제출로 표시를 지우면 번호도 함께 사라진다', () => {
    // 공용 기기를 다음 사람에게 넘기는 자리다 — 앞사람의 번호가 남아 있으면
    // 다음 사람 화면에 그대로 선다.
    markSubmitted('s1', 'sub-1')
    clearSubmitted('s1')
    expect(submittedIds('s1')).toEqual([])
  })
})
