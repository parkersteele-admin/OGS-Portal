/**
 * src/pages/ops/sales/WonAccounts.tsx
 *
 * Table of all won leads. Route: /ops/sales/won
 */

import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getWonLeads } from '../../../services/pipelineService'
import type { PipelineLead } from '../../../types/pipeline'
import './WonAccounts.css'

function tsToDate(ts: unknown): Date | null {
  if (!ts) return null
  if (ts instanceof Date) return ts
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts) return (ts as { toDate: () => Date }).toDate()
  return null
}

function wonDate(lead: PipelineLead): Date | null {
  const entry = [...(lead.stageHistory ?? [])].reverse().find((e) => e.stage === 'won')
  return tsToDate(entry?.enteredAt)
}

const WonAccounts: React.FC = () => {
  const [leads, setLeads]     = useState<PipelineLead[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getWonLeads().then((data) => { setLeads(data); setLoading(false) })
  }, [])

  const totalValue = leads.reduce((s, l) => s + (l.estimatedMonthlyValue ?? 0), 0)

  return (
    <div className="wa-page">
      <header className="wa-header">
        <h1 className="wa-title">Won Accounts</h1>
        <p className="wa-subtitle">
          {leads.length} account{leads.length !== 1 ? 's' : ''} ·{' '}
          ~${totalValue.toLocaleString()}/mo total estimated value
        </p>
      </header>

      {loading ? (
        <div className="wa-loading"><span className="layout-loading__spinner" /></div>
      ) : leads.length === 0 ? (
        <p className="wa-empty">No won accounts yet. Keep going!</p>
      ) : (
        <div className="wa-table-wrap">
          <table className="wa-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Type</th>
                <th>Rep</th>
                <th>Monthly Value</th>
                <th>Won Date</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => {
                const wDate = wonDate(l)
                return (
                  <tr key={l.id}>
                    <td className="wa-td--name">{l.companyName}</td>
                    <td>{l.businessType ?? '—'}</td>
                    <td>{l.assignedTo ?? <span className="wa-unassigned">—</span>}</td>
                    <td>{l.estimatedMonthlyValue > 0 ? `~$${l.estimatedMonthlyValue.toLocaleString()}` : '—'}</td>
                    <td>{wDate ? wDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                    <td><span className="wa-badge wa-badge--won">Won</span></td>
                    <td>
                      <Link to={`/ops/customers/${l.companyId}`} className="wa-link">
                        View Account →
                      </Link>
                    </td>
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

export default WonAccounts
