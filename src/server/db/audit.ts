import { identityKey } from '../../shared/identity'

export type ParticipantRow = {
  id: string
  name: string
  studentId: string
  submittedAt: number
  ipHash: string
  uaHash: string
}

export type DuplicateIdentity = {
  name: string
  studentId: string
  count: number
  submittedAts: number[]
  ipHashes: string[]
}

export type DuplicateDevice = {
  browserKeyHash: string
  count: number
}

export type SharedNetwork = {
  ipHash: string
  count: number
}

export type AuditReport = {
  participants: ParticipantRow[]
  duplicateIdentities: DuplicateIdentity[]
  duplicateDevices: DuplicateDevice[]
  sharedNetworks: SharedNetwork[]
  integrity: {
    participantCount: number
    submissionCount: number
    consistent: boolean
  }
}

/**
 * 이상 징후는 컬럼에 저장하지 않고 볼 때마다 계산한다.
 * 저장하지 않으면 어긋날 여지가 없다.
 */
export async function getAuditReport(
  db: D1Database,
  surveyId: string,
): Promise<AuditReport> {
  const { results: participants } = await db
    .prepare(
      `SELECT id, name, student_id AS studentId, submitted_at AS submittedAt,
              ip_hash AS ipHash, ua_hash AS uaHash
       FROM participants
       WHERE survey_id = ?
       ORDER BY submitted_at`,
    )
    .bind(surveyId)
    .all<ParticipantRow>()

  const byIdentity = new Map<string, ParticipantRow[]>()
  for (const p of participants) {
    // 키는 공유 identityKey 다. 이름과 학번을 공백으로 이어 붙이면
    // 「홍 길동」+「1」과 「홍」+「길동 1」이 같은 키가 되어, 서로 다른 두
    // 사람이 신원 중복으로 고발된다 — 이 화면에서 그 경보는 "누가 남의
    // 이름으로 냈다"는 뜻이라 헛경보의 값이 비싸다(§identityKey).
    const key = identityKey(p)
    const bucket = byIdentity.get(key)
    if (bucket) bucket.push(p)
    else byIdentity.set(key, [p])
  }

  const duplicateIdentities: DuplicateIdentity[] = []
  for (const group of byIdentity.values()) {
    if (group.length < 2) continue
    duplicateIdentities.push({
      name: group[0].name,
      studentId: group[0].studentId,
      count: group.length,
      submittedAts: group.map((p) => p.submittedAt),
      ipHashes: group.map((p) => p.ipHash),
    })
  }

  const { results: duplicateDevices } = await db
    .prepare(
      `SELECT browser_key_hash AS browserKeyHash, COUNT(*) AS count
       FROM submissions
       WHERE survey_id = ?
       GROUP BY browser_key_hash
       HAVING COUNT(*) > 1
       ORDER BY count DESC, browserKeyHash`,
    )
    .bind(surveyId)
    .all<DuplicateDevice>()

  const { results: sharedNetworks } = await db
    .prepare(
      `SELECT ip_hash AS ipHash, COUNT(*) AS count
       FROM participants
       WHERE survey_id = ?
       GROUP BY ip_hash
       HAVING COUNT(*) > 1
       ORDER BY count DESC, ipHash`,
    )
    .bind(surveyId)
    .all<SharedNetwork>()

  const submissionRow = await db
    .prepare('SELECT COUNT(*) AS n FROM submissions WHERE survey_id = ?')
    .bind(surveyId)
    .first<{ n: number }>()

  const participantCount = participants.length
  const submissionCount = submissionRow?.n ?? 0

  return {
    participants,
    duplicateIdentities,
    duplicateDevices,
    sharedNetworks,
    integrity: {
      participantCount,
      submissionCount,
      consistent: participantCount === submissionCount,
    },
  }
}
