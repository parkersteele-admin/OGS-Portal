/**
 * src/pages/dispatch/RunsPage.tsx
 * BEM prefix: rp-
 *
 * Ops/admin runs list — filter by status + date range, link to RunBuilder,
 * RunSummary, and Dispatch Map.
 */

import React, { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getDocs, query, orderBy, where } from 'firebase/firestore'
import { runsCol, usersCol } from '../../lib/firestore'
import type { Run, RunStatus } from '../../types/run'
import type { AppUser } from '../../types/user'
import './RunsPage.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<RunStatus, string> = {
  scheduled:   'Scheduled',
  'in-progress': 'In Progress',
  completed:   'Completed',
  cancelled:   'Cancelled',
}

function fmtDate(ts: { toDate(): Date } | undefined): string {
  if (!ts) return '—'
  return ts.toDate().toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function fetchRuns(): Promise<Run[]> {
  const snap = await getDocs(query(runsCol, orderBy('scheduledDate', 'desc')))
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Run)
}

async function fetchDriverMap(): Promise<Map<string, string>> {
  const snap = await getDocs(query(usersCol, where('role', '==', 'driver')))
  const m = new Map<string, string>()
  snap.docs.forEach((d) => m.set(d.id, (d.data() as AppUser).name))
  return m
}

// ── Status badge ─────────────────────────────────────────────────────────────

const StatusBadge: React.FC<{ status: RunStatus }> = ({ status }) => (
  <span className={`rp-badge rp-badge--${status}`}>{STATUS_LABELS[status]}</span>
)

// ── Main component ────────────────────────────────────────────────────────────

export default function RunsPage() {
  const navigate = useNavigate()

  const [statusFilter, setStatusFilter] = useState<RunStatus | 'all'>('all')
  const [search,       setSearch]       = useState('')

  const runsQuery = useQuery({ queryKey: ['runs'], queryFn: fetchRuns, staleTime: 30_000 })
  const driversQuery = useQuery({ queryKey: ['drivers-map'], queryFn: fetchDriverMap, staleTime: 120_000 })

  const runs    = runsQuery.data    ?? []
  const drivers = driversQuery.data ?? new Map<string, string>()

  const filtered = useMemo(() => {
    return runs.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (search) {
        const q = search.toLowerCase()
        const driverName = drivers.get(r.driverId)?.toLowerCase() ?? ''
        if (!r.runNumber.toLowerCase().includes(q) && !driverName.includes(q)) return false
      }
      return true
    })
  }, [runs, statusFilter, search, drivers])

  // Stats
  const stats = useMemo(() => ({
    scheduled:    runs.filter((r) => r.status === 'scheduled').length,
    'in-progress': runs.filter((r) => r.status === 'in-progress').length,
    completed:    runs.filter((r) => r.status === 'completed').length,
    cancelled:    runs.filter((r) => r.status === 'cancelled').length,
  }), [runs])

  return (
    <div className="rp-page">

      {/* ── Header ────────────────────────────────────────────── */}
      <div className="rp-header">
        <div>
          <h1 className="rp-title">Runs</h1>
          <p className="rp-subtitle">{runs.length} total run{runs.length !== 1 ? 's' : ''}</p>
        </div>
        <button className="rp-btn-new" onClick={() => navigate('/ops/runs/new')}>
          + New Run
        </button>
      </div>

      {/* ── Stat pills ───────────────────────────────────────── */}
      <div className="rp-stats">
        {(['scheduled', 'in-progress', 'completed', 'cancelled'] as RunStatus[]).map((s) => (
          <button
            key={s}
            className={`rp-stat rp-stat--${s}${statusFilter === s ? ' rp-stat--active' : ''}`}
            onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
          >
            <span className="rp-stat__count">{stats[s]}</span>
            <span className="rp-stat__label">{STATUS_LABELS[s]}</span>
          </button>
        ))}
      </div>

      {/* ── Filters ──────────────────────────────────────────── */}
      <div className="rp-filters">
        <input
          type="search"
          className="rp-search"
          placeholder="Search run # or driver…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="rp-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as RunStatus | 'all')}
        >
          <option value="all">All statuses</option>
          {(['scheduled', 'in-progress', 'completed', 'cancelled'] as RunStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        {(search || statusFilter !== 'all') && (
          <button className="rp-clear" onClick={() => { setSearch(''); setStatusFilter('all') }}>
            Clear
          </button>
        )}
        <span className="rp-count">{filtered.length} run{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* ── Table ────────────────────────────────────────────── */}
      <div className="rp-card">
        {runsQuery.isError ? (
          <p className="rp-empty rp-empty--error">Failed to load runs. Please refresh.</p>
        ) : runsQuery.isPending ? (
          <div className="rp-skeleton">
            {[...Array(5)].map((_, i) => <div key={i} className="rp-skeleton__row" />)}
          </div>
        ) : filtered.length === 0 ? (
          <p className="rp-empty">No runs match the current filters.</p>
        ) : (
          <div className="rp-table-wrap">
            <table className="rp-table">
              <thead>
                <tr>
                  <th>Run #</th>
                  <th>Date</th>
                  <th>Driver</th>
                  <th>Stops</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((run) => (
                  <tr key={run.id} className={`rp-tr rp-tr--${run.status}`}>
                    <td className="rp-td-run-num">{run.runNumber}</td>
                    <td>{fmtDate(run.scheduledDate as unknown as { toDate(): Date })}</td>
                    <td>{drivers.get(run.driverId) ?? run.driverId.slice(0, 8) + '…'}</td>
                    <td>{run.stopIds?.length ?? 0}</td>
                    <td><StatusBadge status={run.status} /></td>
                    <td>
                      <div className="rp-actions">
                        {(run.status === 'scheduled' || run.status === 'in-progress') && (
                          <button
                            className="rp-action-btn rp-action-btn--dispatch"
                            onClick={() => navigate(`/ops/dispatch/${run.id}`)}
                          >
                            Dispatch
                          </button>
                        )}
                        {run.status === 'completed' && (
                          <button
                            className="rp-action-btn rp-action-btn--summary"
                            onClick={() => navigate(`/ops/runs/${run.id}/summary`)}
                          >
                            Summary
                          </button>
                        )}
                        {run.status === 'scheduled' && (
                          <button
                            className="rp-action-btn rp-action-btn--summary"
                            onClick={() => navigate(`/ops/runs/${run.id}/summary`)}
                          >
                            View
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
