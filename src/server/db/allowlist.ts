import { newId } from '../anonymity'
import { identityKey, normalizeIdentity, type Identity } from '../../shared/identity'

/**
 * 허용 명단 — 이 설문에 응답할 수 있는 사람을 관리자가 미리 적어 둔 목록.
 *
 * 이 파일은 명부 섬만 읽고 쓴다(allowed_voters, participants). 응답 섬
 * (submissions/answers)은 쳐다보지도 않는다 — 명단과 응답을 한 함수 안에서
 * 함께 다루는 순간 둘을 잇는 코드가 생길 자리가 만들어지기 때문이다.
 *
 * 명단이 비어 있으면 제한이 꺼진 것이다. "빈 명단 = 아무도 못 들어옴"은
 * 이 기능이 없던 시절에 만들어진 설문을 전부 잠가버리므로 택하지 않았다.
 */

export type RosterReport = {
  /** 명단이 하나라도 있으면 참이다. 거짓이면 아래 세 목록은 볼 것이 없다. */
  enabled: boolean
  /** 명단에 있고 이미 낸 사람. */
  participated: Identity[]
  /** 명단에 있는데 아직 안 낸 사람 — 이 기능의 본체. */
  notParticipated: Identity[]
  /** 명단에 없는데 낸 사람. 명단을 나중에 붙였거나 명단 없이 열어 둔 동안 들어온 제출이다. */
  unlisted: Identity[]
}

type IdentityRow = { name: string; studentId: string }

/** 정규화한 뒤 같은 신원을 하나로 접는다. 붙여넣은 명부에 같은 줄이 두 번 있는 건 흔한 일이다. */
function dedupe(identities: Identity[]): Identity[] {
  const byKey = new Map<string, Identity>()
  for (const raw of identities) {
    const identity = normalizeIdentity(raw.name, raw.studentId)
    byKey.set(identityKey(identity), identity)
  }
  return [...byKey.values()]
}

function sortIdentities(identities: Identity[]): Identity[] {
  return [...identities].sort(
    (a, b) => a.name.localeCompare(b.name, 'ko') || a.studentId.localeCompare(b.studentId, 'ko'),
  )
}

export async function getAllowlist(db: D1Database, surveyId: string): Promise<Identity[]> {
  const { results } = await db
    .prepare(
      `SELECT name, student_id AS studentId FROM allowed_voters
       WHERE survey_id = ? ORDER BY name, student_id`,
    )
    .bind(surveyId)
    .all<IdentityRow>()

  // ORDER BY 는 SQLite 의 바이트 순서라 한글이 사전 순으로 서지 않는다.
  // 목록을 사람이 훑어 이름을 찾는 화면이므로 한국어 정렬로 다시 세운다.
  return sortIdentities(results.map((row) => ({ name: row.name, studentId: row.studentId })))
}

/**
 * 명단을 통째로 갈아 끼운다.
 *
 * 두 문장을 한 배치로 보내 지우고 넣는 사이에 빈 명단이 보이는 순간을
 * 없앤다 — 그 순간에 들어온 제출은 "명단이 비었으니 제한 없음"으로 읽혀
 * 그냥 통과해 버린다. 설문이 열려 있는 채로 명단을 고치는 것이 실제
 * 사용 장면이므로(빠진 사람 한 명 추가) 이 틈은 이론상의 것이 아니다.
 */
export async function replaceAllowlist(
  db: D1Database,
  surveyId: string,
  entries: Identity[],
): Promise<void> {
  const rows = dedupe(entries)

  await db.batch([
    db.prepare('DELETE FROM allowed_voters WHERE survey_id = ?').bind(surveyId),
    ...rows.map((identity) =>
      db
        .prepare(
          `INSERT INTO allowed_voters (id, survey_id, name, student_id) VALUES (?, ?, ?, ?)`,
        )
        .bind(newId(), surveyId, identity.name, identity.studentId),
    ),
  ])
}

/**
 * 이 사람이 이 설문에 응답할 수 있는가.
 *
 * 저장할 때 정규화했으므로(replaceAllowlist) 들어온 값도 같은 규칙으로
 * 정규화하면 순수 문자열 비교로 끝난다 — 명부를 통째로 읽어 대조할 필요가
 * 없다.
 */
export async function isAllowed(
  db: D1Database,
  surveyId: string,
  identity: Identity,
): Promise<boolean> {
  const total = await db
    .prepare('SELECT COUNT(*) AS n FROM allowed_voters WHERE survey_id = ?')
    .bind(surveyId)
    .first<{ n: number }>()

  if ((total?.n ?? 0) === 0) return true

  const { name, studentId } = normalizeIdentity(identity.name, identity.studentId)
  const row = await db
    .prepare(
      `SELECT 1 AS hit FROM allowed_voters
       WHERE survey_id = ? AND name = ? AND student_id = ?`,
    )
    .bind(surveyId, name, studentId)
    .first<{ hit: number }>()

  return row !== null
}

/**
 * 명단과 명부를 대조해 참가·미참가·명단 밖 셋으로 가른다.
 *
 * 대조를 SQL 조인이 아니라 JS 에서 하는 이유는 정규화 때문이다. 명부에는
 * 이 기능이 생기기 전에 들어온, 정규화되지 않은 표기가 남아 있을 수 있다
 * (「홍  길동」). SQLite 에는 NFC 정규화가 없어 조인으로는 그 행을 못
 * 맞춘다 — 이미 낸 사람이 미참가로 떠서 관리자가 헛 연락을 하게 된다.
 * 이 앱의 규모는 설문당 30명 안팎이라 양쪽을 다 읽어 Map 으로 맞추는 값이
 * 싸다.
 */
export async function getRoster(db: D1Database, surveyId: string): Promise<RosterReport> {
  const allowed = await getAllowlist(db, surveyId)

  const { results: participantRows } = await db
    .prepare(
      `SELECT name, student_id AS studentId FROM participants
       WHERE survey_id = ? ORDER BY id`,
    )
    .bind(surveyId)
    .all<IdentityRow>()

  const participants = dedupe(participantRows)

  if (allowed.length === 0) {
    return { enabled: false, participated: [], notParticipated: [], unlisted: [] }
  }

  const participantKeys = new Set(participants.map(identityKey))
  const allowedKeys = new Set(allowed.map(identityKey))

  return {
    enabled: true,
    participated: allowed.filter((i) => participantKeys.has(identityKey(i))),
    notParticipated: allowed.filter((i) => !participantKeys.has(identityKey(i))),
    unlisted: sortIdentities(participants.filter((i) => !allowedKeys.has(identityKey(i)))),
  }
}
