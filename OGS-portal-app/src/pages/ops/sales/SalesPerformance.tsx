/**
 * src/pages/ops/sales/SalesPerformance.tsx
 *
 * Sales rep performance metrics. Admin-only. Route: /ops/sales/performance
 */

import React, { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDocs, query, orderBy } from 'firebase/firestore'
import { pipelineLeadsCol } from '../../../lib/firestore'
import { getUsersByRole } from '../../../services/userService'
import type { PipelineLead, StageHistoryEntry } from '../../../types/pipeline'
import './SalesPerformance.css'

type DateRange = '7d' | '30d' | '90d'

function subtractDays(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

function tsToDate(ts: unknown): Date | null {
  if (!ts) return null
  if (ts instanceof Date) return ts
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts) return (ts as { toDate: () => Date }).toDate()
  return null
}

function stageEnteredAt(history: StageHistoryEntry[], stage: string): Date | null {
  const e = history.find((h) => h.stage === stage)
  return e ? tsToDate(e.enteredAt) : null
}

interface RepStats {
  uid:             string
  name:            string
  newLeads:        number
  contacted:       number    // had activity within 48h of assignment
  quotesSent:      number
  won:             number
  lost:            number
  winRate:         number    // %
  totalWonValue:   number
  avgTimeToQuote:  number | null   // days: quote_requested → quote_sent
  avgTimeToClose:  number | null   // days: new_signup → won
}

function computeStats(
  leads: PipelineLead[],
  repUid: string,
  since: Date,
): RepStats {
  const mine = leads.filter((l) => l.assignedTo === repUid)
  const inRange = (ts: unknown) => {
    const d = tsToDate(ts)
    return d ? d >= since : false
  }

  const newLeads   = mine.filter((l) => inRange(l.createdAt)).length
  const quotesSent = mine.filter((l) => inRange(stageEnteredAt(l.stageHistory, 'quote_sent'))).length
  const wonLeads   = mine.filter((l) => l.stage === 'won' && inRange(stageEnteredAt(l.stageHistory, 'won')))
  const lostLeads  = mine.filter((l) => l.stage === 'lost' && inRange(stageEnteredAt(l.stageHistory, 'lost')))

  const contacted  = mine.filter((l) => {
    const assignedAt = tsToDate(l.assignedAt)
    if (!assignedAt) return false
    const cutoff = new Date(assignedAt.getTime() + 48 * 3_600_000)
    return (l.notes ?? []).some((n) => {
      const d = tsToDate(n.createdAt)
      return d && d >= assignedAt && d <= cutoff && n.createdBy !== 'system'
    })
  }).length

  const closedCount = wonLeads.length + lostLeads.length
  const winRate     = closedCount > 0 ? Math.round((wonLeads.length / closedCount) * 100) : 0
  const totalWonValue = wonLeads.reduce((s, l) => s + (l.estimatedMonthlyValue ?? 0), 0)

  // Avg time to quote (days)
  const timeToQuoteDays = mine
    .map((l) => {
      const startD = stageEnteredAt(l.stageHistory, 'new_signup')
      const quoteD = stageEnteredAt(l.stageHistory, 'quote_sent')
      if (!startD || !quoteD) return null
      return (quoteD.getTime() - startD.getTime()) / 86_400_000
    })
    .filter((d): d is number => d !== null)
  const avgTimeToQuote = timeToQuoteDays.length
    ? Math.round(timeToQuoteDays.reduce((s, d) => s + d, 0) / timeToQuoteDays.length)
    : null

  // Avg time to close (days)
  const timeToCloseDays = wonLeads
    .map((l) => {
      const startD = stageEnteredAt(l.stageHistory, 'new_signup')
      const wonD   = stageEnteredAt(l.stageHistory, 'won')
      if (!startD || !wonD) return null
      return (wonD.getTime() - startD.getTime()) / 86_400_000
    })
    .filter((d): d is number => d !== null)
  const avgTimeToClose = timeToCloseDays.length
    ? Math.round(timeToCloseDays.reduce((s, d) => s + d, 0) / timeToCloseDays.length)
    : null

  return {
    uid: repUid, name: '', newLeads, contacted, quotesSent,
    won: wonLeads.length, lost: lostLeads.length, winRate, totalWonValue,
    avgTimeToQuote, avgTimeToClose,
  }
}

const SalesPerformance: React.FC = () => {
  const [range, setRange] = useState<DateRange>('30d')
  const since = range === '7d' ? subtractDays(7) : range === '30d' ? subtractDays(30) : subtractDays(90)

  const { data: reps = [] } = useQuery({
    queryKey: ['users', 'sales'],
    queryFn:  () => getUsersByRole('sales'),
    staleTime: 5 * 60_000,
  })

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ['pipeline', 'all-for-perf'],
    queryFn:  async () => {
      const snap = await getDocs(query(pipelineLeadsCol, orderBy('createdAt', 'desc')))
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as PipelineLead)
    },
    staleTime: 2 * 60_000,
  })

  type RepInfo = { id: string; firstName?: string; lastName?: string; name?: string }
  const repNameMap: Record<string, string> = {}
  for (const r of reps as RepInfo[]) {
    repNameMap[r.id] = (r as RepInfo).name ?? `${(r as RepInfo).firstName ?? ''} ${(r as RepInfo).lastName ?? ''}`.trim()
  }

  const stats = useMemo<RepStats[]>(() => {
    return (reps as RepInfo[]).map((r) => ({
      ...computeStats(leads, r.id, since),
      name: repNameMap[r.id] ?? r.id,
    }))
  }, [leads, reps, since])

  return (
    <div className="sp-page">
      <header className="sp-header">
        <h1 className="sp-title">Rep Performance</h1>
        <div className="sp-range-tabs">
          {(['7d', '30d', '90d'] as DateRange[]).map((r) => (
            <button
              key={r}
              className={`sp-range-btn${range === r ? ' sp-range-btn--on' : ''}`}
              onClick={() => setRange(r)}
            >
              {r === '7d' ? 'Last 7 days' : r === '30d' ? 'Last 30 days' : 'Last 90 days'}
            </button>
          ))}
        </div>
      </header>

      {isLoading ? (
        <div className="sp-loading"><span className="layout-loading__spinner" /></div>
      ) : (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <thead>
              <tr>
                <th>Rep</th>
                <th>New Leads</th>
                <th title="Had activity within 48h of assignment">Contacted</th>
                <th>Quotes Sent</th>
                <th>Won</th>
                <th>Lost</th>
                <th>Win Rate</th>
                <th>Won Value</th>
                <th title="Average days from new_signup to quote_sent">Avg Time to Quote</th>
                <th title="Average days from new_signup to won">Avg Time to Close</th>
              </tr>
            </thead>
            <tbody>
              {stats.length === 0 ? (
                <tr><td colSpan={10} className="sp-empty">No reps found</td></tr>
              ) : stats.map((s) => (
                <tr key={s.uid}>
                  <td className="sp-td--name">{s.name}</td>
                  <td>{s.newLeads}</td>
                  <td>{s.contacted}</td>
                  <td>{s.quotesSent}</td>
                  <td className="sp-td--won">{s.won}</td>
                  <td className="sp-td--lost">{s.lost}</td>
                  <td>{s.winRate}%</td>
                  <td>{s.totalWonValue > 0 ? `~$${s.totalWonValue.toLocaleString()}` : '—'}</td>
                  <td>{s.avgTimeToQuote != null ? `${s.avgTimeToQuote}d` : '—'}</td>
                  <td>{s.avgTimeToClose != null ? `${s.avgTimeToClose}d` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default SalesPerformance
