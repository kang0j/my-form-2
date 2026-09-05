import type { SurveyStatus } from '../../shared/schema'

/** 설문 목록·상세 화면이 함께 쓰는 상태 이름. 관리자는 개발자가 아니므로
 * 영문 상태값을 그대로 보여주지 않는다. */
export const STATUS_LABELS: Record<SurveyStatus, string> = {
  draft: '작성 중',
  open: '진행 중',
  closed: '마감',
}
