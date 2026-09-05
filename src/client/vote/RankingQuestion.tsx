import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { CSSProperties } from 'react'
import type { QuestionDef } from '../../shared/schema'
import { moveRankingItem } from './draft'

type Props = {
  question: QuestionDef
  order: string[]
  onChange: (order: string[]) => void
}

type ItemProps = {
  id: string
  label: string
  rank: number
  index: number
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
}

function SortableItem({
  id,
  label,
  rank,
  index,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: ItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id })

  return (
    <li
      ref={setNodeRef}
      className="ranking-row enter-item"
      style={
        {
          transform: CSS.Transform.toString(transform),
          transition,
          '--enter-index': index + 2,
        } as CSSProperties
      }
    >
      {/* 별도의 손잡이 아이콘을 그리지 않는다(§OWN-WORLD — 아이콘 자산 금지,
          fix 3) — 이미 있는 순위 숫자가 그 자리를 겸한다: 시각적으로도
          잡을 곳으로 읽히고, dnd-kit 의 드래그 속성도 여기로 옮긴다.
          예전의 ⠿ 는 aria-hidden 인 채로 이 속성들(role="button"
          tabIndex=0)을 받아 스크린리더에는 안 보이면서 포커스만 걸리는
          요소가 됐었다(§fix 6) — 지금은 aria-hidden 을 걷어내고 실제
          접근 가능한 이름을 준다. */}
      <span
        className="ranking-row__rank"
        aria-label={`${label} 끌어서 순서 바꾸기, 지금 ${rank}번째예요`}
        {...attributes}
        {...listeners}
      >
        {rank}
      </span>
      <span className="ranking-row__label">{label}</span>
      <span className="ranking-row__moves">
        <button
          type="button"
          className="ranking-row__move"
          aria-label={`${label} 위로`}
          disabled={!canMoveUp}
          onClick={onMoveUp}
        >
          위로
        </button>
        <button
          type="button"
          className="ranking-row__move"
          aria-label={`${label} 아래로`}
          disabled={!canMoveDown}
          onClick={onMoveDown}
        >
          아래로
        </button>
      </span>
    </li>
  )
}

export function RankingQuestion({ question, order, onChange }: Props) {
  const labelOf = new Map(question.options.map((o) => [o.id, o.label]))
  const sensors = useSensors(
    // 탭이 드래그로 오인되지 않도록 최소 이동 거리를 둔다 — 위/아래 버튼을
    // 눌렀을 때 그 탭이 드래그 시작으로 먹히지 않아야 한다.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // 손가락으로 순서를 바꾸려는 의도가 분명할 때만 드래그를 시작한다.
    // 지연·허용오차가 없으면 스크롤 제스처와 매번 충돌한다(휴대폰 필수).
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const from = order.indexOf(String(active.id))
    const to = order.indexOf(String(over.id))
    onChange(moveRankingItem(order, from, to))
  }

  return (
    <fieldset>
      <legend
        className="question-screen__title enter-item"
        style={{ '--enter-index': 0 } as CSSProperties}
      >
        {question.title}
        {question.required && <span className="question-screen__required">필수</span>}
      </legend>
      {question.description && (
        <p
          className="question-screen__description enter-item"
          style={{ '--enter-index': 1 } as CSSProperties}
        >
          {question.description}
        </p>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ol className="ranking-list">
            {order.map((optionId, index) => (
              <SortableItem
                key={optionId}
                id={optionId}
                label={labelOf.get(optionId) ?? ''}
                rank={index + 1}
                index={index}
                canMoveUp={index > 0}
                canMoveDown={index < order.length - 1}
                onMoveUp={() => onChange(moveRankingItem(order, index, index - 1))}
                onMoveDown={() => onChange(moveRankingItem(order, index, index + 1))}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </fieldset>
  )
}
