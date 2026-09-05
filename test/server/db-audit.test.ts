import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { getAuditReport } from '../../src/server/db/audit'

const SURVEY_ID = 'survey-1'
const NOW = Date.UTC(2026, 8, 2, 1, 0)

async function addParticipant(
  name: string,
  studentId: string,
  ipHash: string,
  offsetMs = 0,
): Promise<void> {
  await env.DB
    .prepare(
      `INSERT INTO participants (id, survey_id, name, student_id, submitted_at, ip_hash, ua_hash)
       VALUES (?, ?, ?, ?, ?, ?, 'ua')`,
    )
    .bind(crypto.randomUUID(), SURVEY_ID, name, studentId, NOW + offsetMs, ipHash)
    .run()
}

async function addSubmission(browserKeyHash: string): Promise<void> {
  await env.DB
    .prepare(
      `INSERT INTO submissions (id, survey_id, browser_key_hash)
       VALUES (?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), SURVEY_ID, browserKeyHash)
    .run()
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM surveys').run()
  await env.DB.prepare('DELETE FROM participants').run()
  await env.DB.prepare('DELETE FROM submissions').run()
  await env.DB
    .prepare(
      `INSERT INTO surveys (id, title, description, status, results_visibility, created_at)
       VALUES (?, '설문', '', 'open', 'after_close', ?)`,
    )
    .bind(SURVEY_ID, NOW)
    .run()
})

describe('명부', () => {
  it('참여자를 제출 시각 순으로 돌려준다', async () => {
    await addParticipant('김철수', '20250002', 'ip-b', 1000)
    await addParticipant('홍길동', '20250001', 'ip-a', 0)

    const report = await getAuditReport(env.DB, SURVEY_ID)
    expect(report.participants.map((p) => p.name)).toEqual(['홍길동', '김철수'])
  })
})

describe('신원 중복', () => {
  it('같은 이름·학번이 2건 이상이면 잡아낸다', async () => {
    await addParticipant('홍길동', '20250001', 'ip-a', 0)
    await addParticipant('홍길동', '20250001', 'ip-b', 60000)
    await addParticipant('김철수', '20250002', 'ip-c', 0)

    const report = await getAuditReport(env.DB, SURVEY_ID)
    expect(report.duplicateIdentities).toHaveLength(1)
    expect(report.duplicateIdentities[0]).toMatchObject({
      name: '홍길동',
      studentId: '20250001',
      count: 2,
    })
    expect(report.duplicateIdentities[0].submittedAts).toEqual([NOW, NOW + 60000])
    expect(report.duplicateIdentities[0].ipHashes).toEqual(['ip-a', 'ip-b'])
  })

  it('중복이 없으면 빈 배열이다', async () => {
    await addParticipant('홍길동', '20250001', 'ip-a')
    expect((await getAuditReport(env.DB, SURVEY_ID)).duplicateIdentities).toEqual([])
  })

  // 이름에 공백이 든 사람이 실제로 있다. 이름과 학번을 공백 하나로 이어
  // 키를 만들면 「홍 길동」+「1」과 「홍」+「길동 1」이 같은 키가 되어 서로
  // 다른 두 사람이 신원 중복으로 고발된다(§identityKey).
  it('이름 안의 공백 때문에 다른 사람이 같은 사람으로 묶이지 않는다', async () => {
    await addParticipant('홍 길동', '1', 'ip-a', 0)
    await addParticipant('홍', '길동 1', 'ip-b', 60000)

    expect((await getAuditReport(env.DB, SURVEY_ID)).duplicateIdentities).toEqual([])
  })

  it('이름이 같아도 학번이 다르면 중복이 아니다', async () => {
    await addParticipant('홍길동', '20250001', 'ip-a')
    await addParticipant('홍길동', '20250009', 'ip-b')
    expect((await getAuditReport(env.DB, SURVEY_ID)).duplicateIdentities).toEqual([])
  })
})

describe('기기 중복', () => {
  it('같은 브라우저 키 해시가 2건 이상이면 잡아낸다', async () => {
    await addSubmission('device-1')
    await addSubmission('device-1')
    await addSubmission('device-2')

    const report = await getAuditReport(env.DB, SURVEY_ID)
    expect(report.duplicateDevices).toEqual([{ browserKeyHash: 'device-1', count: 2 }])
  })

  it('개수가 같으면 해시 오름차순으로 동률을 정한다', async () => {
    // ORDER BY count DESC, browserKeyHash 의 두 번째 정렬 기준을 검사한다.
    // 삽입은 일부러 역순(z, b, a)으로 해서 삽입 순서가 우연히 결과와
    // 같아지는 것을 배제한다.
    await addSubmission('zzz-device')
    await addSubmission('zzz-device')
    await addSubmission('bbb-device')
    await addSubmission('bbb-device')
    await addSubmission('aaa-device')
    await addSubmission('aaa-device')

    const report = await getAuditReport(env.DB, SURVEY_ID)
    expect(report.duplicateDevices.map((d) => d.browserKeyHash)).toEqual([
      'aaa-device',
      'bbb-device',
      'zzz-device',
    ])
  })
})

describe('동일 네트워크', () => {
  it('같은 IP 해시가 2건 이상이면 표시한다', async () => {
    await addParticipant('홍길동', '20250001', 'ip-shared')
    await addParticipant('김철수', '20250002', 'ip-shared')
    await addParticipant('이영희', '20250003', 'ip-solo')

    const report = await getAuditReport(env.DB, SURVEY_ID)
    expect(report.sharedNetworks).toEqual([{ ipHash: 'ip-shared', count: 2 }])
  })

  it('개수가 같으면 IP 해시 오름차순으로 동률을 정한다', async () => {
    await addParticipant('참가자1', '2025', 'zzz-ip')
    await addParticipant('참가자2', '2026', 'zzz-ip')
    await addParticipant('참가자3', '2027', 'bbb-ip')
    await addParticipant('참가자4', '2028', 'bbb-ip')
    await addParticipant('참가자5', '2029', 'aaa-ip')
    await addParticipant('참가자6', '2030', 'aaa-ip')

    const report = await getAuditReport(env.DB, SURVEY_ID)
    expect(report.sharedNetworks.map((n) => n.ipHash)).toEqual(['aaa-ip', 'bbb-ip', 'zzz-ip'])
  })
})

describe('정합성 경보', () => {
  it('명부 수와 응답 수가 같으면 정상이다', async () => {
    await addParticipant('홍길동', '20250001', 'ip-a')
    await addSubmission('device-1')

    const report = await getAuditReport(env.DB, SURVEY_ID)
    expect(report.integrity).toEqual({
      participantCount: 1,
      submissionCount: 1,
      consistent: true,
    })
  })

  it('어긋나면 경보를 올린다', async () => {
    await addParticipant('홍길동', '20250001', 'ip-a')

    const report = await getAuditReport(env.DB, SURVEY_ID)
    expect(report.integrity.consistent).toBe(false)
  })
})
