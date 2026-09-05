/**
 * 익명성 원시 연산을 모아둔 파일.
 *
 * 명부(participants)와 응답(submissions/answers)이 이어지지 않는다는 이 시스템의
 * 핵심 성질은 이 파일 하나를 읽는 것으로 감사할 수 있어야 한다. 다른 파일에서
 * crypto.subtle 이나 crypto.randomUUID 를 직접 부르지 않는다.
 */

const encoder = new TextEncoder()

/** 랜덤 PK. 자동 증가 ID 는 삽입 순서를 드러내므로 쓰지 않는다. */
export function newId(): string {
  return crypto.randomUUID()
}

/**
 * 설문 ID 전용 — 링크(`/s/{id}`)에 그대로 실려 사람이 읽고 옮겨 적는
 * 유일한 ID 라서, 36자 UUID 대신 대소문자·숫자 6자를 쓴다.
 *
 * 짧아진 만큼 추측 가능성을 따져 둔다: 62^6 ≈ 568억. 링크는 비밀이 아니라
 * 주소이고(설문 자체는 링크를 아는 사람에게 열려 있다), 이 앱이 다루는
 * 규모는 한 기관의 설문 수십~수백 개다. 그 규모에서 무작위 추측이 맞을
 * 확률은 사실상 0 이고, 자동 증가 ID 처럼 순서나 총량을 드러내지도 않는다.
 * 명부·응답 분리라는 익명성 성질은 ID 길이와 무관하다.
 *
 * 균등성: 256 은 62 의 배수가 아니므로 바이트를 그냥 % 62 하면 앞쪽 8글자가
 * 더 자주 나온다. 248(= 62 × 4) 이상인 바이트는 버리고 다시 뽑는다.
 */
const SURVEY_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const SURVEY_ID_LENGTH = 6
const REJECT_AT = 256 - (256 % SURVEY_ID_ALPHABET.length)

export function newSurveyId(): string {
  let id = ''
  while (id.length < SURVEY_ID_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(SURVEY_ID_LENGTH))
    for (const byte of bytes) {
      if (byte >= REJECT_AT) continue
      id += SURVEY_ID_ALPHABET[byte % SURVEY_ID_ALPHABET.length]
      if (id.length === SURVEY_ID_LENGTH) break
    }
  }
  return id
}

/**
 * secret 당 한 번만 임포트한 HMAC 키를 재사용한다. 제출 하나가 브라우저 키·
 * IP·UA 세 번을 해싱하는데(§recordSubmission), 매번 같은 HMAC_SECRET 을
 * 다시 임포트할 이유가 없다 — 무엇을 해싱하는지·어떻게 해싱하는지는
 * 그대로이고, 같은 키를 다시 만드는 일만 줄인다. Promise 를 캐싱해서
 * 같은 요청 안에서 동시에 여러 번 불려도(§원자적 배치) 임포트가 한 번만
 * 일어난다.
 */
const keyCache = new Map<string, Promise<CryptoKey>>()

function importedHmacKey(secret: string): Promise<CryptoKey> {
  const cached = keyCache.get(secret)
  if (cached) return cached

  const key = crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  keyCache.set(secret, key)
  return key
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await importedHmacKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * 브라우저 키 해시. survey_id 를 섞어 같은 기기라도 설문마다 다른 값이 나오게 한다.
 * 설문 안에서의 중복 탐지는 유지하면서 설문 간 연결만 끊는다.
 */
export function hashBrowserKey(
  secret: string,
  browserKey: string,
  surveyId: string,
): Promise<string> {
  return hmacHex(secret, `browser-key:${surveyId}:${browserKey}`)
}

export function hashIp(secret: string, ip: string): Promise<string> {
  return hmacHex(secret, `ip:${ip}`)
}

export function hashUa(secret: string, userAgent: string): Promise<string> {
  return hmacHex(secret, `user-agent:${userAgent}`)
}
