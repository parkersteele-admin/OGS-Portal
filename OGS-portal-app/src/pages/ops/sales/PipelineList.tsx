/**
 * src/pages/ops/sales/PipelineList.tsx
 *
 * Full-width table view of all active leads with sorting and bulk actions.
 * Route: /ops/sales/pipeline
 */

import React, { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LeadDetailDrawer } from '../../../components/sales/LeadDetailDrawer'
import {
  subscribeToActiveLeads,
  callAssignLead,
  updateLeadPriority,
} from '../../../services/pipelineService'
import { getUsersByRole } from '../../../services/userService'
import type { PipelineLead, LeadPriority } from '../../../types/pipeline'
import { STAGE_LABELS } from '../../../types/pipeline'
import './PipelineList.css'

type SortField = 'estimatedMonthlyValue' | 'updatedAt' | 'nextFollowUpAt' | 'companyName'
type SortDir   = 'asc' | 'desc'

function tsToDate(ts: unknown): Date | null {
  if (!ts) return null
  if (ts instanceof Date) return ts
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts) return (ts as { toDate: () => Date }).toDate()
  return null
}

function timeInStage(lead: PipelineLead): number {
  const current = [...(lead.stageHistory ?? [])].reverse().find((e) => e.stage === lead.stage)
  const date    = tsToDate(current?.enteredAt)
  if (!date) return 0
  return Math.floor((Date.now() - date.getTime()) / 86_400_000)
}

function buildRepNames(users: Array<{ id: string; firstName?: string; lastName?: string; name?: string }>): Record<string, string> {
  const map: Record<string, string> = {}
  for (const u of users) map[u.id] = u.name ?? (`${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.id)
  return map
}

const PRIORITY_LABELS: Record<LeadPriority, string> = {
  high: 'High', normal: 'Normal', low: 'Low',
}

const PipelineList: React.FC = () => {
  const navigate                                  = useNavigate()
  const [leads, setLeads]                         = useState<PipelineLead[]>([])
  const [loading, setLoading]                     = useState(true)
  const [sortField, setSortField]                 = useState<SortField>('estimatedMonthlyValue')
  const [sortDir, setSortDir]                     = useState<SortDir>('desc')
  const [selected, setSelected]                   = useState<Set<string>>(new Set())
  const [selectedLead, setSelectedLead]           = useState<PipelineLead | null>(null)
  const [bulkAssignUid, setBulkAssignUid]         = useState('')
  const [bulkPriority, setBulkPriority]           = useState<LeadPriority | ''>('')
  const [bulkWorking, setBulkWorking]             = useState(false)

  const repsQuery = useQuery({
    queryKey: ['users', 'sales'],
    queryFn: () => getUsersByRole('sales'),
    staleTime: 5 * 60_000,
  })
  const repNames = buildRepNames(repsQuery.data ?? [])

  useEffect(() => {
    const unsub = subscribeToActiveLeads((liveLeads) => {
      setLeads(liveLeads)
      setLoading(false)
    })
    return unsub
  }, [])

  // Sync selected lead
  useEffect(() => {
    if (selectedLead) {
      const fresh = leads.find((l) => l.id === selectedLead.id)
      if (fresh) setSelectedLead(fresh)
    }
  }, [leads, selectedLead?.id])

  const sorted = useMemo(() => {
    return [...leads].sort((a, b) => {
      let av: number | string = 0
      let bv: number | string = 0
      if (sortField === 'estimatedMonthlyValue') {
        av = a.estimatedMonthlyValue ?? 0
        bv = b.estimatedMonthlyValue ?? 0
      } else if (sortField === 'updatedAt') {
        av = tsToDate(a.updatedAt)?.getTime() ?? 0
        bv = tsToDate(b.updatedAt)?.getTime() ?? 0
      } else if (sortField === 'nextFollowUpAt') {
        av = tsToDate(a.nextFollowUpAt)?.getTime() ?? 0
        bv = tsToDate(b.nextFollowUpAt)?.getTime() ?? 0
      } else {
        av = a.companyName.toLowerCase()
        bv = b.companyName.toLowerCase()
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1  : -1
      return 0
    })
  }, [leads, sortField, sortDir])

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  const sortIcon = (field: SortField) =>
    sortField !== field ? '' : sortDir === 'asc' ? ' ↑' : ' ↓'

  const toggleSelectAll = () => {
    if (selected.size === sorted.length) setSelected(new Set())
    else setSelected(new Set(sorted.map((l) => l.id)))
  }

  const toggleSelect = (id: string) => {
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelected(next)
  }

  const handleBulkAssign = async () => {
    if (!bulkAssignUid || selected.size === 0) return
    setBulkWorking(true)
    try {
      await Promise.allSettled(
        [...selected].map((id) => {
          const lead = leads.find((l) => l.id === id)
          return lead ? callAssignLead(lead.companyId, bulkAssignUid) : Promise.resolve()
        }),
      )
      setSelected(new Set())
      setBulkAssignUid('')
    } finally {
      setBulkWorking(false)
    }
  }

  const handleBulkPriority = async () => {
    if (!bulkPriority || selected.size === 0) return
    setBulkWorking(true)
    try {
      await Promise.allSettled(
        [...selected].map((id) => {
          const lead = leads.find((l) => l.id === id)
          return lead ? updateLeadPriority(lead.companyId, bulkPriority) : Promise.resolve()
        }),
      )
      setSelected(new Set())
      setBulkPriority('')
    } finally {
      setBulkWorking(false)
    }
  }

  const exportCSV = () => {
    const rows = sorted
      .filter((l) => selected.size === 0 || selected.has(l.id))
      .map((l) => [
        l.companyName, l.businessType ?? '', STAGE_LABELS[l.stage],
        repNames[l.assignedTo ?? ''] ?? 'Unassigned',
        l.estimatedMonthlyValue,
        timeInStage(l),
        l.priority,
      ])
    const header = ['Company', 'Type', 'Stage', 'Rep', 'Est. Value', 'Days in Stage', 'Priority']
    const csv    = [header, ...rows].map((r) => r.join(',')).join('\n')
    const blob   = new Blob([csv], { type: 'text/csv' })
    const url    = URL.createObjectURL(blob)
    const a      = document.createElement('a')
    a.href = url; a.download = 'pipeline.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="pl-page">
      <header className="pl-header">
        <h1 className="pl-title">Pipeline — List View</h1>
        <div className="pl-header-actions">
          <button className="pl-btn pl-btn--outline" onClick={() => navigate('/crm/pipeline')}>
            Board View ◈
          </button>
          <button className="pl-btn pl-btn--outline" onClick={exportCSV}>
            Export CSV
          </button>
        </div>
      </header>

      {selected.size > 0 && (
        <div className="pl-bulk-bar">
          <span>{selected.size} selected</span>
          <select
            className="pl-bulk-select"
            value={bulkAssignUid}
            onChange={(e) => setBulkAssignUid(e.target.value)}
          >
            <option value="">Assign to rep…</option>
            {Object.entries(repNames).map(([uid, name]) => (
              <option key={uid} value={uid}>{name}</option>
            ))}
          </select>
          <button className="pl-btn--sm" disabled={!bulkAssignUid || bulkWorking} onClick={handleBulkAssign}>
            Assign
          </button>

          <select
            className="pl-bulk-select"
            value={bulkPriority}
            onChange={(e) => setBulkPriority(e.target.value as LeadPriority)}
          >
            <option value="">Set priority…</option>
            {(['high', 'normal', 'low'] as LeadPriority[]).map((p) => (
              <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
            ))}
          </select>
          <button className="pl-btn--sm" disabled={!bulkPriority || bulkWorking} onClick={handleBulkPriority}>
            Apply
          </button>
        </div>
      )}

      {loading ? (
        <div className="pl-loading"><span className="layout-loading__spinner" /></div>
      ) : (
        <div className="pl-table-wrap">
          <table className="pl-table">
            <thead>
              <tr>
                <th><input type="checkbox" onChange={toggleSelectAll} checked={selected.size > 0 && selected.size === sorted.length} /></th>
                <th className="pl-th--sortable" onClick={() => toggleSort('companyName')}>Company{sortIcon('companyName')}</th>
                <th>Type</th>
                <th>Stage</th>
                <th>Rep</th>
                <th className="pl-th--sortable" onClick={() => toggleSort('estimatedMonthlyValue')}>Est. Value{sortIcon('estimatedMonthlyValue')}</th>
                <th className="pl-th--sortable" onClick={() => toggleSort('updatedAt')}>Time in Stage{sortIcon('updatedAt')}</th>
                <th className="pl-th--sortable" onClick={() => toggleSort('nextFollowUpAt')}>Next Follow-Up{sortIcon('nextFollowUpAt')}</th>
                <th>Priority</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr><td colSpan={10} className="pl-empty">No active leads</td></tr>
              ) : sorted.map((l) => {
                const followUp = tsToDate(l.nextFollowUpAt)
                const days     = timeInStage(l)
                const daysClass = days >= 14 ? 'pl-days--critical' : days >= 7 ? 'pl-days--warn' : ''
                return (
                  <tr key={l.id} className={selected.has(l.id) ? 'pl-row--selected' : ''}>
                    <td><input type="checkbox" checked={selected.has(l.id)} onChange={() => toggleSelect(l.id)} /></td>
                    <td className="pl-td--name">{l.companyName}</td>
                    <td>{l.businessType ?? '—'}</td>
                    <td><span className={`pl-stage-badge pl-stage-badge--${l.stage}`}>{STAGE_LABELS[l.stage]}</span></td>
                    <td>{l.assignedTo ? (repNames[l.assignedTo] ?? '—') : <span className="pl-unassigned">Unassigned</span>}</td>
                    <td>{l.estimatedMonthlyValue > 0 ? `~$${l.estimatedMonthlyValue.toLocaleString()}` : '—'}</td>
                    <td><span className={daysClass}>{days}d</span></td>
                    <td>
                      {followUp
                        ? <span className={followUp < new Date() ? 'pl-overdue' : ''}>{followUp.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        : '—'
                      }
                    </td>
                    <td><span className={`pl-priority pl-priority--${l.priority}`}>{PRIORITY_LABELS[l.priority]}</span></td>
                    <td>
                      <button className="pl-detail-btn" onClick={() => setSelectedLead(l)}>
                        Details
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedLead && (
        <LeadDetailDrawer
          lead={selectedLead}
          repNames={repNames}
          onClose={() => setSelectedLead(null)}
          onUpdated={() => setSelectedLead(null)}
        />
      )}
    </div>
  )
}

export default PipelineList
