/**
 * 이 앱의 시계는 하나다 — 한국 표준시(KST, UTC+9).
 *
 * 관리자와 투표자가 같은 교실에 있는 앱인데도 시각을 브라우저 시간대로
 * 읽으면, 시계가 어긋난 노트북 하나가 「9시 마감」을 다른 시각으로 적어
 * 보낸다. 그래서 화면에 적히는 시각과 관리자가 적어 넣는 시각을 모두 KST
 * 하나로 고정한다. 저장과 비교는 여전히 절대 시각(epoch ms)이다 — 시간대는
 * 사람이 읽고 쓰는 껍데기에만 있다.
 *
 * 한국은 서머타임이 없으므로 고정 오프셋으로 충분하다. Intl 의 timeZone 을
 * 쓰지 않는 것은 Workers·jsdom·브라우저가 모두 같은 답을 내야 하기 때문이다.
 */
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** epoch ms → `YYYY-MM-DD HH:mm` (KST). 표·CSV 가 쓴다. */
export function formatKst(epochMs: number): string {
  return new Date(epochMs + KST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ')
}

/** epoch ms → `<input type="datetime-local">` 값(KST). */
export function toKstInput(epochMs: number | null): string {
  if (epochMs === null) return ''
  return new Date(epochMs + KST_OFFSET_MS).toISOString().slice(0, 16)
}

/**
 * `<input type="datetime-local">` 값(KST 로 읽는다) → epoch ms.
 *
 * `new Date(value)` 에 맡기지 않는다 — 그 함수는 같은 문자열을 브라우저
 * 시간대로 읽어, 시간대가 다른 기기에서 다른 시각이 된다.
 */
export function fromKstInput(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(trimmed)
  if (!match) return null
  const [, y, mo, d, h, mi] = match
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)) - KST_OFFSET_MS
}
