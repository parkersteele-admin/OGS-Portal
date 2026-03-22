/**
 * src/pages/dispatch/RunsPage.tsx
 * BEM prefix: rp-
 *
 * Ops/admin runs list — filter by status + date range, link to RunBuilder,
 * RunSummary, and Dispatch Map.
 */

import React, { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getDocs, query, orderBy, where } from 'firebase/firestore'
import { runsCol, usersCol } from '../../../lib/firestore'
import { archiveRun, deleteRun } from '../../../services/runService'
import type { Run, RunStatus } from '../../../types/run'
import type { AppUser } from '../../../types/user'
import { Button } from '../../../components/ui/Button'
import './RunsPage.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<RunStatus, string> = {
  scheduled:     'Scheduled',
  'in-progress': 'In Progress',
  completed:     'Completed',
  cancelled:     'Cancelled',
  archived:      'Archived',
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
  const [selected,     setSelected]     = useState<Set<string>>(new Set())

  const queryClient = useQueryClient()

  const runsQuery = useQuery({ queryKey: ['runs'], queryFn: fetchRuns, staleTime: 30_000 })
  const driversQuery = useQuery({ queryKey: ['drivers-map'], queryFn: fetchDriverMap, staleTime: 120_000 })

  const runs    = runsQuery.data    ?? []
  const drivers = driversQuery.data ?? new Map<string, string>()

  const filtered = useMemo(() => {
    return runs.filter((r) => {
      if (statusFilter === 'all' && r.status === 'archived') return false
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
    scheduled:     runs.filter((r) => r.status === 'scheduled').length,
    'in-progress': runs.filter((r) => r.status === 'in-progress').length,
    completed:     runs.filter((r) => r.status === 'completed').length,
    cancelled:     runs.filter((r) => r.status === 'cancelled').length,
    archived:      runs.filter((r) => r.status === 'archived').length,
  }), [runs])

  // Selection
  const selectableFiltered = filtered.filter((r) => r.status !== 'archived')
  const allSelected = selectableFiltered.length > 0 && selectableFiltered.every((r) => selected.has(r.id))

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) { selectableFiltered.forEach((r) => next.delete(r.id)) }
      else             { selectableFiltered.forEach((r) => next.add(r.id)) }
      return next
    })
  }

  function toggleRow(id: string, status: RunStatus) {
    if (status === 'archived') return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  async function handleBulkArchive() {
    if (!selected.size) return
    const count = selected.size
    if (!confirm(`Archive ${count} run${count !== 1 ? 's' : ''}? They will be hidden from the default view.`)) return
    try {
      await Promise.all([...selected].map((id) => archiveRun(id)))
      setSelected(new Set())
      queryClient.invalidateQueries({ queryKey: ['runs'] })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to archive runs.')
    }
  }

  async function handleBulkDelete() {
    if (!selected.size) return
    const count = selected.size
    if (!confirm(`Permanently delete ${count} run${count !== 1 ? 's' : ''}? This cannot be undone.`)) return
    try {
      await Promise.all([...selected].map((id) => deleteRun(id)))
      setSelected(new Set())
      queryClient.invalidateQueries({ queryKey: ['runs'] })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete runs.')
    }
  }

  const selectedCount = selected.size

  return (
    <div className="rp-page">

      {/* ── Header ────────────────────────────────────────────── */}
      <div className="rp-header">
        <div>
          <h1 className="rp-title">Runs</h1>
          <p className="rp-subtitle">{runs.length} total run{runs.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="rp-header__actions">
          <Button
            variant="secondary"
            size="sm"
            disabled={selectedCount === 0}
            onClick={handleBulkArchive}
          >
            Archive{selectedCount > 0 ? ` (${selectedCount})` : ''}
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={selectedCount === 0}
            onClick={handleBulkDelete}
          >
            Delete{selectedCount > 0 ? ` (${selectedCount})` : ''}
          </Button>
          <Button variant="primary" onClick={() => navigate('/ops/runs/new')}>
            + New Run
          </Button>
        </div>
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
                  <th className="rp-th--check">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      disabled={selectableFiltered.length === 0}
                      title="Select all"
                      aria-label="Select all runs"
                    />
                  </th>
                  <th>Run #</th>
                  <th>Date</th>
                  <th>Driver</th>
                  <th>Stops</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((run) => {
                  const isSelected = selected.has(run.id)
                  const canSel = run.status !== 'archived'
                  return (
                    <tr key={run.id} className={`rp-tr rp-tr--${run.status}${isSelected ? ' rp-tr--selected' : ''}`}>
                      <td className="rp-td--check" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(run.id, run.status)}
                          disabled={!canSel}
                          aria-label={`Select run ${run.runNumber}`}
                        />
                      </td>
                      <td className="rp-td-run-num">{run.runNumber}</td>
                      <td>{fmtDate(run.scheduledDate as unknown as { toDate(): Date })}</td>
                      <td>{drivers.get(run.driverId) ?? run.driverId.slice(0, 8) + '…'}</td>
                      <td>{run.stopIds?.length ?? 0}</td>
                      <td><StatusBadge status={run.status} /></td>
                      <td>
                        <div className="rp-actions">
                          {(run.status === 'scheduled' || run.status === 'in-progress') && (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => navigate(`/ops/dispatch/${run.id}`)}
                            >
                              Dispatch
                            </Button>
                          )}
                          {run.status === 'completed' && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => navigate(`/ops/runs/${run.id}/summary`)}
                            >
                              Summary
                            </Button>
                          )}
                          {run.status === 'scheduled' && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => navigate(`/ops/runs/${run.id}/summary`)}
                            >
                              View
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
