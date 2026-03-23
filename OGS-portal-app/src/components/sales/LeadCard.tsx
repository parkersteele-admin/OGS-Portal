/**
 * src/components/sales/LeadCard.tsx
 *
 * Kanban card for a single PipelineLead. Used inside PipelineBoard columns.
 * Supports dnd-kit drag-and-drop via useSortable.
 */

import React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { isPast } from 'date-fns'
import type { PipelineLead, LeadPriority } from '../../types/pipeline'
import './LeadCard.css'

// ── Business type color map ───────────────────────────────────────────────────

const BUSINESS_TYPE_CLASS: Record<string, string> = {
  brewery:     'lc-badge--brewery',
  restaurant:  'lc-badge--restaurant',
  medical:     'lc-badge--medical',
  industrial:  'lc-badge--industrial',
  residential: 'lc-badge--residential',
}

// ── Priority indicator ────────────────────────────────────────────────────────

function PriorityDot({ priority }: { priority: LeadPriority }) {
  return (
    <span
      className={`lc-priority lc-priority--${priority}`}
      title={`${priority.charAt(0).toUpperCase() + priority.slice(1)} priority`}
      aria-label={`${priority} priority`}
    />
  )
}

// ── Rep initials avatar ───────────────────────────────────────────────────────

function RepAvatar({ uid, repNames }: { uid: string | null; repNames: Record<string, string> }) {
  if (!uid) {
    return <span className="lc-avatar lc-avatar--unassigned" title="Unassigned">?</span>
  }
  const name    = repNames[uid] ?? uid
  const initials = name.split(' ').map((p) => p[0]).join('').toUpperCase().slice(0, 2)
  return (
    <span className="lc-avatar" title={name} aria-label={`Assigned to ${name}`}>
      {initials}
    </span>
  )
}

// ── Time-in-stage badge ───────────────────────────────────────────────────────

function TimeInStage({ lead }: { lead: PipelineLead }) {
  const history = lead.stageHistory
  const current = [...history].reverse().find((e) => e.stage === lead.stage)
  if (!current?.enteredAt) return null
  const enteredAt = (current.enteredAt as { toDate: () => Date }).toDate()
  const days = Math.floor((Date.now() - enteredAt.getTime()) / 86_400_000)
  const cls  = days >= 14 ? 'lc-age--critical' : days >= 7 ? 'lc-age--warn' : ''
  return (
    <span className={`lc-age ${cls}`} title={`Entered this stage ${days} day${days !== 1 ? 's' : ''} ago`}>
      {days === 0 ? 'Today' : `${days}d`}
    </span>
  )
}

// ── Follow-up date ────────────────────────────────────────────────────────────

function FollowUpTag({ nextFollowUpAt }: { nextFollowUpAt: PipelineLead['nextFollowUpAt'] }) {
  if (!nextFollowUpAt) return null
  const date    = (nextFollowUpAt as { toDate: () => Date }).toDate()
  const overdue = isPast(date)
  const label   = overdue
    ? 'Overdue'
    : `Follow up: ${date.toLocaleDateString('en-US', { weekday: 'short' })}`
  return (
    <span className={`lc-followup${overdue ? ' lc-followup--overdue' : ''}`}>{label}</span>
  )
}

// ── LeadCard ──────────────────────────────────────────────────────────────────

interface LeadCardProps {
  lead:      PipelineLead
  repNames:  Record<string, string>
  onClick:   (lead: PipelineLead) => void
  isDragging?: boolean
}

export const LeadCard: React.FC<LeadCardProps> = ({ lead, repNames, onClick }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: lead.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const typeClass = BUSINESS_TYPE_CLASS[lead.businessType?.toLowerCase() ?? ''] ?? ''
  const emv       = lead.estimatedMonthlyValue

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`lc-card${isDragging ? ' lc-card--dragging' : ''}`}
      onClick={() => onClick(lead)}
      {...attributes}
      {...listeners}
    >
      <header className="lc-card__header">
        <h3 className="lc-card__name">{lead.companyName}</h3>
        <PriorityDot priority={lead.priority} />
      </header>

      <div className="lc-card__meta">
        {lead.businessType && (
          <span className={`lc-badge ${typeClass}`}>{lead.businessType}</span>
        )}
        <TimeInStage lead={lead} />
      </div>

      <div className="lc-card__value">
        {emv > 0
          ? <span className="lc-emv" title="Estimated monthly value — for internal use only">~${emv.toLocaleString()}/mo est.</span>
          : <span className="lc-emv lc-emv--empty">—</span>
        }
      </div>

      <footer className="lc-card__footer">
        <RepAvatar uid={lead.assignedTo} repNames={repNames} />
        <FollowUpTag nextFollowUpAt={lead.nextFollowUpAt} />
      </footer>
    </article>
  )
}
