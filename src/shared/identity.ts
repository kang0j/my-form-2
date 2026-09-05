/**
 * 이름·학번을 "같은 사람인가"를 물을 수 있는 하나의 모양으로 모은다.
 *
 * 이 앱에서 신원은 세 곳에서 서로 대조된다 — 허용 명단(allowed_voters),
 * 명부(participants), 그리고 투표자가 표지에 직접 손으로 적는 값. 세 값이
 * 각각 다른 경로로 들어오는데(관리자가 엑셀에서 붙여넣고, 학생이 휴대폰
 * 자판으로 치고), 눈에 같아 보이는 두 문자열이 코드포인트로는 다른 일이
 * 흔하다. 그 차이를 여기 한 곳에서 흡수하지 않으면 명단에 이름이 멀쩡히
 * 있는데도 문 앞에서 막히는 사람이 생긴다 — 인앱 브라우저에서 그 사람이
 * 할 수 있는 일은 아무것도 없다.
 *
 * 흡수하는 차이는 셋뿐이다:
 * - 앞뒤 공백(붙여넣기가 거의 항상 달고 온다)
 * - 가운데 연속 공백(손으로 정렬한 명부의 「홍  길동」)
 * - 유니코드 합성 형태(macOS 가 만든 CSV 는 한글을 NFD 로 담아 온다)
 *
 * 대소문자는 건드리지 않는다 — 한글에는 없는 개념이고, 학번에 섞인 영문
 * 접두어(예: `A20250001`)를 관리자가 구별해 적었다면 그 구별을 지울 이유가
 * 없다.
 */
export type Identity = {
  name: string
  studentId: string
}

function normalizeField(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ')
}

export function normalizeIdentity(name: string, studentId: string): Identity {
  return { name: normalizeField(name), studentId: normalizeField(studentId) }
}

/** 정규화한 뒤 이름·학번이 둘 다 같아야 같은 사람이다(동명이인은 학번으로 갈린다). */
export function sameIdentity(a: Identity, b: Identity): boolean {
  const left = normalizeIdentity(a.name, a.studentId)
  const right = normalizeIdentity(b.name, b.studentId)
  return left.name === right.name && left.studentId === right.studentId
}

/**
 * 정규화한 신원을 Map·Set 키로 쓸 때의 표준 형태.
 *
 * 이름과 학번을 공백으로 이으면 「홍 길」+「동 1」과 「홍」+「길 동 1」이
 * 같은 키가 되어, 명단에 없는 사람이 명단에 있는 사람의 자리를 차지할 수
 * 있다. normalizeIdentity 가 모든 공백류를 U+0020 한 칸으로 바꾼 뒤라
 * U+0000 은 두 칸 어디에도 남아 있을 수 없으므로, 그것으로 가른다.
 */
export function identityKey(identity: Identity): string {
  const { name, studentId } = normalizeIdentity(identity.name, identity.studentId)
  return `${name}\u0000${studentId}`
}
