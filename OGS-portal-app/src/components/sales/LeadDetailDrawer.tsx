/**
 * src/components/sales/LeadDetailDrawer.tsx
 *
 * Right-side slide-over showing full lead details with tabs:
 * Overview | Activity | Follow-Up
 * Plus Won / Lost action buttons at the bottom.
 */

import React, { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { formatDistanceToNow, format, addDays, nextMonday } from 'date-fns'
import {
  callAdvanceLeadStage,
  callLogLeadActivity,
  callAssignLead,
  callMarkLeadWon,
  callMarkLeadLost,
  callScheduleFollowUp,
  updateLeadPriority,
} from '../../services/pipelineService'
import type {
  PipelineLead,
  PipelineStage,
  ActivityEntry,
  ActivityType,
  LossReason,
} from '../../types/pipeline'
import { STAGE_LABELS, BOARD_STAGES, LOSS_REASON_LABELS } from '../../types/pipeline'
import './LeadDetailDrawer.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

function tsToDate(ts: unknown): Date | null {
  if (!ts) return null
  if (ts instanceof Date) return ts
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts) {
    return (ts as { toDate: () => Date }).toDate()
  }
  return null
}

function setupProgress(lead: PipelineLead): number {
  // setupStep is on the customer doc — use stageHistory as proxy
  const stages: PipelineStage[] = ['new_signup', 'pending_setup', 'quote_requested', 'quote_sent', 'negotiating', 'won']
  return stages.indexOf(lead.stage)
}

// ── Activity feed item ────────────────────────────────────────────────────────

function ActivityItem({ entry }: { entry: ActivityEntry }) {
  const date    = tsToDate(entry.createdAt)
  const typeIcons: Record<ActivityType, string> = {
    note: '📝', call: '📞', email: '✉️', meeting: '🤝',
    stage_change: '→', system: '⚙',
  }
  return (
    <li className="ldd-activity-item">
      <span className="ldd-activity-icon">{typeIcons[entry.type] ?? '•'}</span>
      <div className="ldd-activity-body">
        <p className="ldd-activity-text">{entry.body}</p>
        {date && (
          <time className="ldd-activity-time" dateTime={date.toISOString()}>
            {formatDistanceToNow(date, { addSuffix: true })}
          </time>
        )}
      </div>
    </li>
  )
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab({ lead }: { lead: PipelineLead }) {
  const emv        = lead.estimatedMonthlyValue
  const stageIdx   = setupProgress(lead)
  const totalSteps = 5

  return (
    <div className="ldd-tab-panel">
      <section className="ldd-section">
        <h4 className="ldd-section-title">Pipeline Value</h4>
        <p className="ldd-emv">
          {emv > 0
            ? <><strong>~${emv.toLocaleString()}/mo</strong> <span className="ldd-emv-note">estimated from usage</span></>
            : <span className="ldd-emv-note">Not yet calculated</span>
          }
        </p>
      </section>

      <section className="ldd-section">
        <h4 className="ldd-section-title">Setup Progress</h4>
        <div className="ldd-steps">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`ldd-step ${i < stageIdx ? 'ldd-step--done' : i === stageIdx ? 'ldd-step--current' : ''}`}
            />
          ))}
        </div>
        <p className="ldd-steps-label">Step {Math.min(stageIdx, totalSteps)} of {totalSteps}</p>
      </section>

      <section className="ldd-section">
        <h4 className="ldd-section-title">Account Info</h4>
        <dl className="ldd-dl">
          <dt>Business Type</dt>
          <dd>{lead.businessType ?? '—'}</dd>
          <dt>Source</dt>
          <dd>{lead.source.replace('_', ' ')}</dd>
          <dt>Tags</dt>
          <dd>{lead.tags.length > 0 ? lead.tags.join(', ') : '—'}</dd>
        </dl>
      </section>
    </div>
  )
}

// ── Activity tab ──────────────────────────────────────────────────────────────

function ActivityTab({ lead, onActivityLogged }: { lead: PipelineLead; onActivityLogged: () => void }) {
  const [type, setType]       = useState<ActivityType>('note')
  const [body, setBody]       = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const sortedNotes = [...(lead.notes ?? [])].sort((a, b) => {
    const aDate = tsToDate(a.createdAt)?.getTime() ?? 0
    const bDate = tsToDate(b.createdAt)?.getTime() ?? 0
    return bDate - aDate
  })

  const handleLog = async () => {
    if (!body.trim()) return
    setSaving(true)
    setError(null)
    try {
      await callLogLeadActivity(lead.companyId, type, body)
      setBody('')
      onActivityLogged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log activity')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ldd-tab-panel">
      <div className="ldd-log-bar">
        <select
          className="ldd-log-type"
          value={type}
          onChange={(e) => setType(e.target.value as ActivityType)}
        >
          <option value="note">Note</option>
          <option value="call">Call</option>
          <option value="email">Email</option>
          <option value="meeting">Meeting</option>
        </select>
        <textarea
          className="ldd-log-input"
          placeholder="Add a note..."
          rows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <button className="ldd-log-btn" onClick={handleLog} disabled={saving || !body.trim()}>
          {saving ? 'Saving…' : 'Log'}
        </button>
      </div>
      {error && <p className="ldd-error">{error}</p>}

      {sortedNotes.length === 0
        ? <p className="ldd-empty">No activity yet.</p>
        : (
          <ul className="ldd-activity-list">
            {sortedNotes.map((e) => <ActivityItem key={e.id} entry={e} />)}
          </ul>
        )
      }
    </div>
  )
}

// ── Follow-Up tab ─────────────────────────────────────────────────────────────

function FollowUpTab({ lead, onSaved }: { lead: PipelineLead; onSaved: () => void }) {
  const [dateVal, setDateVal] = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const currentDate = tsToDate(lead.nextFollowUpAt)

  const quickSet = async (date: Date) => {
    setSaving(true)
    try {
      await callScheduleFollowUp(lead.companyId, date)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule follow-up')
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async () => {
    if (!dateVal) return
    setSaving(true)
    setError(null)
    try {
      await callScheduleFollowUp(lead.companyId, new Date(dateVal))
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule follow-up')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ldd-tab-panel">
      {currentDate && (
        <p className="ldd-followup-current">
          Scheduled: <strong>{format(currentDate, 'MMM d, yyyy')}</strong>
        </p>
      )}

      <div className="ldd-followup-quick">
        <button className="ldd-quick-btn" onClick={() => quickSet(addDays(new Date(), 1))} disabled={saving}>Tomorrow</button>
        <button className="ldd-quick-btn" onClick={() => quickSet(addDays(new Date(), 3))} disabled={saving}>In 3 days</button>
        <button className="ldd-quick-btn" onClick={() => quickSet(nextMonday(new Date()))} disabled={saving}>Next Monday</button>
      </div>

      <div className="ldd-followup-custom">
        <input
          type="datetime-local"
          className="ldd-date-input"
          value={dateVal}
          onChange={(e) => setDateVal(e.target.value)}
        />
        <button className="ldd-save-btn" onClick={handleSave} disabled={saving || !dateVal}>
          {saving ? 'Saving…' : 'Schedule'}
        </button>
      </div>

      {error && <p className="ldd-error">{error}</p>}
    </div>
  )
}

// ── Lost modal ────────────────────────────────────────────────────────────────

function LostModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: (reason: LossReason, note: string) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState<LossReason>('chose_competitor')
  const [note, setNote]     = useState('')
  const firstRef            = useRef<HTMLSelectElement>(null)

  useEffect(() => { firstRef.current?.focus() }, [])

  return (
    <div className="ldd-modal-overlay" role="dialog" aria-modal>
      <div className="ldd-modal">
        <h3 className="ldd-modal-title">Mark as Lost</h3>
        <label className="ldd-label">
          Loss reason
          <select
            ref={firstRef}
            className="ldd-select"
            value={reason}
            onChange={(e) => setReason(e.target.value as LossReason)}
          >
            {(Object.entries(LOSS_REASON_LABELS) as [LossReason, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
        <label className="ldd-label">
          Note (optional)
          <textarea
            className="ldd-textarea"
            placeholder="Additional context..."
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <div className="ldd-modal-actions">
          <button className="ldd-btn ldd-btn--danger" onClick={() => onConfirm(reason, note)}>
            Mark Lost
          </button>
          <button className="ldd-btn ldd-btn--ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── Won modal ─────────────────────────────────────────────────────────────────

function WonModal({ onConfirm, onCancel }: { onConfirm: (note: string) => void; onCancel: () => void }) {
  const [note, setNote] = useState('')
  return (
    <div className="ldd-modal-overlay" role="dialog" aria-modal>
      <div className="ldd-modal">
        <h3 className="ldd-modal-title">Mark as Won 🎉</h3>
        <label className="ldd-label">
          Win note (optional)
          <textarea
            className="ldd-textarea"
            placeholder="What closed the deal?"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            autoFocus
          />
        </label>
        <div className="ldd-modal-actions">
          <button className="ldd-btn ldd-btn--success" onClick={() => onConfirm(note)}>
            Mark Won
          </button>
          <button className="ldd-btn ldd-btn--ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── LeadDetailDrawer ──────────────────────────────────────────────────────────

type DrawerTab = 'overview' | 'activity' | 'followup'

interface LeadDetailDrawerProps {
  lead:       PipelineLead
  repNames:   Record<string, string>
  onClose:    () => void
  onUpdated:  () => void
}

export const LeadDetailDrawer: React.FC<LeadDetailDrawerProps> = ({
  lead,
  repNames,
  onClose,
  onUpdated,
}) => {
  const [tab, setTab]             = useState<DrawerTab>('overview')
  const [saving, setSaving]       = useState(false)
  const [showLost, setShowLost]   = useState(false)
  const [showWon, setShowWon]     = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const allStages: PipelineStage[] = [...BOARD_STAGES]

  const handleStageChange = async (stage: PipelineStage) => {
    if (stage === lead.stage) return
    setSaving(true)
    setError(null)
    try {
      await callAdvanceLeadStage(lead.companyId, stage)
      onUpdated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stage change failed')
    } finally {
      setSaving(false)
    }
  }

  const handleAssign = async (uid: string) => {
    setSaving(true)
    try {
      await callAssignLead(lead.companyId, uid || null)
      onUpdated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Assignment failed')
    } finally {
      setSaving(false)
    }
  }

  const handlePriority = async (priority: 'high' | 'normal' | 'low') => {
    try {
      await updateLeadPriority(lead.companyId, priority)
      onUpdated()
    } catch { /* silent */ }
  }

  const handleConfirmLost = async (reason: LossReason, note: string) => {
    setSaving(true)
    setShowLost(false)
    try {
      await callMarkLeadLost(lead.companyId, reason, note)
      onUpdated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark lost')
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmWon = async (note: string) => {
    setSaving(true)
    setShowWon(false)
    try {
      await callMarkLeadWon(lead.companyId, note)
      onUpdated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark won')
    } finally {
      setSaving(false)
    }
  }

  const BUSINESS_TYPE_CLASS: Record<string, string> = {
    brewery: 'ldd-badge--brewery', restaurant: 'ldd-badge--restaurant',
    medical: 'ldd-badge--medical', industrial: 'ldd-badge--industrial',
  }

  return (
    <>
      <div className="ldd-overlay" onClick={onClose} aria-hidden />

      <aside className="ldd-drawer" role="complementary" aria-label="Lead details">
        {/* Header */}
        <div className="ldd-header">
          <div className="ldd-header-top">
            <div>
              <h2 className="ldd-company-name">{lead.companyName}</h2>
              {lead.businessType && (
                <span className={`ldd-badge ${BUSINESS_TYPE_CLASS[lead.businessType?.toLowerCase() ?? ''] ?? ''}`}>
                  {lead.businessType}
                </span>
              )}
            </div>
            <button className="ldd-close" onClick={onClose} aria-label="Close">✕</button>
          </div>

          {/* Stage selector */}
          <div className="ldd-controls">
            <label className="ldd-ctrl-label">
              Stage
              <select
                className="ldd-select ldd-select--stage"
                value={lead.stage}
                onChange={(e) => handleStageChange(e.target.value as PipelineStage)}
                disabled={saving || lead.stage === 'won' || lead.stage === 'lost'}
              >
                {allStages.map((s) => (
                  <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                ))}
              </select>
            </label>

            <label className="ldd-ctrl-label">
              Priority
              <div className="ldd-priority-group">
                {(['high', 'normal', 'low'] as const).map((p) => (
                  <button
                    key={p}
                    className={`ldd-pri-btn ldd-pri-btn--${p}${lead.priority === p ? ' ldd-pri-btn--on' : ''}`}
                    onClick={() => handlePriority(p)}
                  >
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </label>

            <label className="ldd-ctrl-label">
              Assigned rep
              <select
                className="ldd-select"
                value={lead.assignedTo ?? ''}
                onChange={(e) => handleAssign(e.target.value)}
                disabled={saving}
              >
                <option value="">Unassigned</option>
                {Object.entries(repNames).map(([uid, name]) => (
                  <option key={uid} value={uid}>{name}</option>
                ))}
              </select>
            </label>

            <Link
              to={`/ops/customers/${lead.companyId}`}
              className="ldd-view-link"
            >
              View Full Account →
            </Link>
          </div>
        </div>

        {/* Tabs */}
        <nav className="ldd-tabs" role="tablist">
          {(['overview', 'activity', 'followup'] as DrawerTab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`ldd-tab${tab === t ? ' ldd-tab--active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'overview' ? 'Overview' : t === 'activity' ? 'Activity' : 'Follow-Up'}
            </button>
          ))}
        </nav>

        {/* Tab panels */}
        <div className="ldd-body">
          {error && <p className="ldd-error">{error}</p>}

          {tab === 'overview'  && <OverviewTab    lead={lead} />}
          {tab === 'activity'  && <ActivityTab    lead={lead} onActivityLogged={onUpdated} />}
          {tab === 'followup'  && <FollowUpTab    lead={lead} onSaved={onUpdated} />}
        </div>

        {/* Won/Lost actions */}
        {lead.stage !== 'won' && lead.stage !== 'lost' && (
          <div className="ldd-actions">
            <button
              className="ldd-btn ldd-btn--success ldd-btn--full"
              onClick={() => setShowWon(true)}
              disabled={saving}
            >
              ✓ Mark as Won
            </button>
            <button
              className="ldd-btn ldd-btn--danger ldd-btn--full"
              onClick={() => setShowLost(true)}
              disabled={saving}
            >
              ✗ Mark as Lost
            </button>
          </div>
        )}
      </aside>

      {showLost && <LostModal onConfirm={handleConfirmLost} onCancel={() => setShowLost(false)} />}
      {showWon  && <WonModal  onConfirm={handleConfirmWon}  onCancel={() => setShowWon(false)} />}
    </>
  )
}
