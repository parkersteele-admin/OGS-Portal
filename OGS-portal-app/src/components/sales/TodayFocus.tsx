/**
 * src/components/sales/TodayFocus.tsx
 *
 * Right sidebar panel for the Sales Dashboard showing three sections:
 *  - Overdue Follow-Ups
 *  - New Signups Today
 *  - Stalled Leads
 */

import React from 'react'
import { formatDistanceToNow } from 'date-fns'
import type { PipelineLead } from '../../types/pipeline'
import { STAGE_LABELS } from '../../types/pipeline'
import './TodayFocus.css'

function tsToDate(ts: unknown): Date | null {
  if (!ts) return null
  if (ts instanceof Date) return ts
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts) {
    return (ts as { toDate: () => Date }).toDate()
  }
  return null
}

function daysAgo(ts: unknown): string {
  const d = tsToDate(ts)
  if (!d) return '—'
  return formatDistanceToNow(d, { addSuffix: true })
}

function daysOverdue(ts: unknown): string {
  const d = tsToDate(ts)
  if (!d) return '—'
  const diff = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return '1 day overdue'
  return `${diff} days overdue`
}

// ── Section ───────────────────────────────────────────────────────────────────

interface SectionProps {
  title:    string
  count:    number
  children: React.ReactNode
  empty:    string
  isEmpty:  boolean
}

function Section({ title, count, children, empty, isEmpty }: SectionProps) {
  return (
    <section className="tf-section">
      <header className="tf-section-header">
        <h3 className="tf-section-title">{title}</h3>
        {count > 0 && <span className="tf-section-count">{count}</span>}
      </header>
      {isEmpty ? <p className="tf-empty">{empty}</p> : children}
    </section>
  )
}

// ── TodayFocus ────────────────────────────────────────────────────────────────

interface TodayFocusProps {
  overdue:    PipelineLead[]
  newSignups: PipelineLead[]
  stalled:    PipelineLead[]
  repNames:   Record<string, string>
  onCardClick: (lead: PipelineLead) => void
  loading?: boolean
}

export const TodayFocus: React.FC<TodayFocusProps> = ({
  overdue,
  newSignups,
  stalled,
  repNames,
  onCardClick,
  loading,
}) => {
  if (loading) {
    return (
      <aside className="tf-panel">
        <div className="tf-loading" aria-live="polite">Loading…</div>
      </aside>
    )
  }

  return (
    <aside className="tf-panel">
      <h2 className="tf-panel-title">Today's Focus</h2>

      <Section
        title="Overdue Follow-Ups"
        count={overdue.length}
        empty="No overdue follow-ups. Nice work."
        isEmpty={overdue.length === 0}
      >
        <ul className="tf-list">
          {overdue.map((l) => (
            <li key={l.id} className="tf-item tf-item--overdue" onClick={() => onCardClick(l)}>
              <div className="tf-item-name">{l.companyName}</div>
              <div className="tf-item-meta">
                <span className="tf-stage-badge">{STAGE_LABELS[l.stage]}</span>
                <span className="tf-overdue-label">{daysOverdue(l.nextFollowUpAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="New Signups Today"
        count={newSignups.length}
        empty="No new signups today."
        isEmpty={newSignups.length === 0}
      >
        <ul className="tf-list">
          {newSignups.map((l) => (
            <li key={l.id} className="tf-item" onClick={() => onCardClick(l)}>
              <div className="tf-item-name">{l.companyName}</div>
              <div className="tf-item-meta">
                {l.businessType && <span className="tf-type">{l.businessType}</span>}
                <span className="tf-time">{daysAgo(l.createdAt)}</span>
                <span className={`tf-rep${l.assignedTo ? '' : ' tf-rep--unassigned'}`}>
                  {l.assignedTo ? (repNames[l.assignedTo] ?? 'Rep') : 'Unassigned'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Stalled Leads"
        count={stalled.length}
        empty="No stalled leads."
        isEmpty={stalled.length === 0}
      >
        <ul className="tf-list">
          {stalled.map((l) => (
            <li key={l.id} className="tf-item tf-item--stalled" onClick={() => onCardClick(l)}>
              <div className="tf-item-name">{l.companyName}</div>
              <div className="tf-item-meta">
                <span className="tf-time">Last activity {daysAgo(l.updatedAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </aside>
  )
}
