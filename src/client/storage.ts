const BROWSER_KEY = 'anonymous-vote:browser-key'
const draftKey = (surveyId: string) => `anonymous-vote:draft:${surveyId}`
const submittedKey = (surveyId: string) => `anonymous-vote:submitted:${surveyId}`

/**
 * `crypto.randomUUID` 는 구형 안드로이드 WebView(Chrome < 92)와 비보안(non-https)
 * 컨텍스트에서 존재하지 않는다. 이게 없다고 예외가 나면 투표 자체가 시작조차 못
 * 되므로, 단계적으로 낮춰가며 반드시 값을 만들어낸다.
 *
 * 1) crypto.randomUUID() — 표준 경로.
 * 2) crypto.getRandomValues() 로 v4 UUID 를 직접 조립 — WebView 는 있어도
 *    randomUUID 만 없는 경우가 흔하다.
 * 3) Math.random() — crypto 객체 자체가 없는 최후의 경우. 브라우저 키의
 *    무작위성 요구는 "충돌 없이 기기를 구분"하는 정도이지 암호학적 안전성이
 *    아니므로(§PRODUCT: 도용은 차단하지 않고 탐지만 한다), 이 마지막 단계도
 *    제출을 막는 것보다 낫다.
 */
export function createUuid(): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto

  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    try {
      return cryptoObj.randomUUID()
    } catch {
      // 아래 단계로 계속 진행.
    }
  }

  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    try {
      const bytes = new Uint8Array(16)
      cryptoObj.getRandomValues(bytes)
      // RFC 4122 v4: 버전/변이 비트를 강제한다.
      bytes[6] = (bytes[6] & 0x0f) | 0x40
      bytes[8] = (bytes[8] & 0x3f) | 0x80
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
      return [
        hex.slice(0, 4).join(''),
        hex.slice(4, 6).join(''),
        hex.slice(6, 8).join(''),
        hex.slice(8, 10).join(''),
        hex.slice(10, 16).join(''),
      ].join('-')
    } catch {
      // 아래 단계로 계속 진행.
    }
  }

  // crypto 자체가 없는 환경. Math.random() 은 암호학적으로 안전하지 않지만,
  // 기기 구분용 키 생성을 막는 것보다는 낫다.
  const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
  return template.replace(/[xy]/g, (char) => {
    const r = (Math.random() * 16) | 0
    const value = char === 'x' ? r : (r & 0x3) | 0x8
    return value.toString(16)
  })
}

/**
 * 기기마다 하나인 랜덤 키. 서버는 이 값을 그대로 저장하지 않고
 * 설문 ID 를 섞어 해싱한 값만 응답 쪽에 남긴다.
 */
export function getBrowserKey(): string {
  try {
    const existing = localStorage.getItem(BROWSER_KEY)
    if (existing) return existing

    const created = createUuid()
    localStorage.setItem(BROWSER_KEY, created)
    return created
  } catch {
    // 시크릿 창처럼 저장이 막힌 환경. 매번 새 키가 되지만 제출은 되어야 한다.
    return createUuid()
  }
}

export function saveDraft(surveyId: string, draft: unknown): void {
  try {
    localStorage.setItem(draftKey(surveyId), JSON.stringify(draft))
  } catch {
    // 저장이 막혀 있어도 작성은 계속할 수 있어야 한다.
  }
}

export function loadDraft<T>(surveyId: string): T | null {
  try {
    const raw = localStorage.getItem(draftKey(surveyId))
    return raw === null ? null : (JSON.parse(raw) as T)
  } catch {
    return null
  }
}

export function clearDraft(surveyId: string): void {
  try {
    localStorage.removeItem(draftKey(surveyId))
  } catch {
    // 무시
  }
}

export function hasSubmitted(surveyId: string): boolean {
  try {
    return localStorage.getItem(submittedKey(surveyId)) !== null
  } catch {
    return false
  }
}

export function markSubmitted(surveyId: string): void {
  try {
    localStorage.setItem(submittedKey(surveyId), '1')
  } catch {
    // 무시
  }
}

export function clearSubmitted(surveyId: string): void {
  try {
    localStorage.removeItem(submittedKey(surveyId))
  } catch {
    // 무시
  }
}
