/**
 * src/pages/ops/sales/LostLeads.tsx
 *
 * Table of all lost leads for retrospective analysis. Route: /ops/sales/lost
 */

import React, { useState, useEffect } from 'react'
import { getLostLeads } from '../../../services/pipelineService'
import type { PipelineLead } from '../../../types/pipeline'
import { LOSS_REASON_LABELS } from '../../../types/pipeline'
import './LostLeads.css'

function tsToDate(ts: unknown): Date | null {
  if (!ts) return null
  if (ts instanceof Date) return ts
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts) return (ts as { toDate: () => Date }).toDate()
  return null
}

function lostDate(lead: PipelineLead): Date | null {
  const entry = [...(lead.stageHistory ?? [])].reverse().find((e) => e.stage === 'lost')
  return tsToDate(entry?.enteredAt)
}

const LostLeads: React.FC = () => {
  const [leads, setLeads]     = useState<PipelineLead[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getLostLeads().then((data) => { setLeads(data); setLoading(false) })
  }, [])

  // Group by loss reason for insight
  const byReason: Record<string, number> = {}
  for (const l of leads) {
    const r = l.lostReason ?? 'unknown'
    byReason[r] = (byReason[r] ?? 0) + 1
  }

  return (
    <div className="ll-page">
      <header className="ll-header">
        <h1 className="ll-title">Lost Leads</h1>
        <p className="ll-subtitle">{leads.length} lost lead{leads.length !== 1 ? 's' : ''}</p>
      </header>

      {Object.keys(byReason).length > 0 && (
        <div className="ll-breakdown">
          {Object.entries(byReason)
            .sort(([, a], [, b]) => b - a)
            .map(([reason, count]) => (
              <span key={reason} className="ll-reason-chip">
                {LOSS_REASON_LABELS[reason as keyof typeof LOSS_REASON_LABELS] ?? reason}: {count}
              </span>
            ))
          }
        </div>
      )}

      {loading ? (
        <div className="ll-loading"><span className="layout-loading__spinner" /></div>
      ) : leads.length === 0 ? (
        <p className="ll-empty">No lost leads on record.</p>
      ) : (
        <div className="ll-table-wrap">
          <table className="ll-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Type</th>
                <th>Rep</th>
                <th>Est. Value</th>
                <th>Lost Date</th>
                <th>Loss Reason</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => {
                const lDate = lostDate(l)
                const reasonLabel = l.lostReason
                  ? (LOSS_REASON_LABELS[l.lostReason as keyof typeof LOSS_REASON_LABELS] ?? l.lostReason)
                  : '—'
                return (
                  <tr key={l.id}>
                    <td className="ll-td--name">{l.companyName}</td>
                    <td>{l.businessType ?? '—'}</td>
                    <td>{l.assignedTo ?? '—'}</td>
                    <td>{l.estimatedMonthlyValue > 0 ? `~$${l.estimatedMonthlyValue.toLocaleString()}` : '—'}</td>
                    <td>{lDate ? lDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                    <td><span className="ll-reason">{reasonLabel}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default LostLeads
