/**
 * src/features/operations/pages/InventoryPage.tsx
 * BEM prefix: inv-
 *
 * Warehouse inventory overview at /ops/inventory.
 *
 * Shows a real-time summary of cylinder stock:
 *   - Status breakdown cards (Available, On Truck, Deployed, Returned, Inspection)
 *   - Gas-type grid (count of available cylinders per gas type)
 *   - Inspection alerts (cylinders overdue or due in 30 days)
 *   - Quick links to /ops/tanks for detailed cylinder management
 */

import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { onSnapshot, query, orderBy } from 'firebase/firestore'
import { tanksCol } from '../../../lib/firestore'
import { getTanksDueForInspection } from '../../../services/tankService'
import { Button } from '../../../components/ui/Button'
import type { Tank, TankStatus } from '../../../types/tank'
import './InventoryPage.css'

// ── Constants ────────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<TankStatus, string> = {
  available:  'Available',
  on_truck:   'On Truck',
  deployed:   'Deployed',
  returned:   'Returned',
  inspection: 'Inspection',
}

const STATUS_COLORS: Record<TankStatus, string> = {
  available:  '#16a34a',
  on_truck:   'var(--color-brand)',
  deployed:   '#2563eb',
  returned:   '#7c3aed',
  inspection: '#ef4444',
}

const ALL_STATUSES: TankStatus[] = ['available', 'on_truck', 'deployed', 'returned', 'inspection']

// ── Helpers ─────────────────────────────────────────────────────────────────────

function fmtDate(ts: { toDate?: () => Date } | null | undefined): string {
  if (!ts?.toDate) return '—'
  return ts.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const opsBase  = location.pathname.startsWith('/admin') ? '/admin/ops' : '/ops'
  const [tanks, setTanks] = useState<Tank[]>([])
  const [inspectionDue, setInspectionDue] = useState<Tank[]>([])
  const [loading, setLoading] = useState(true)

  // Real-time tank snapshot
  useEffect(() => {
    const unsub = onSnapshot(
      query(tanksCol, orderBy('gasType')),
      (snap) => {
        setTanks(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Tank))
        setLoading(false)
      },
    )
    return unsub
  }, [])

  // Inspection alerts (due within 30 days)
  useEffect(() => {
    getTanksDueForInspection(30)
      .then(setInspectionDue)
      .catch(() => {})
  }, [])

  // Status counts
  const statusCounts = useMemo(() => {
    const counts: Record<TankStatus, number> = {
      available: 0, on_truck: 0, deployed: 0, returned: 0, inspection: 0,
    }
    tanks.forEach((t) => { counts[t.status]++ })
    return counts
  }, [tanks])

  // Available cylinders by gas type
  const availableByGas = useMemo(() => {
    const map: Record<string, number> = {}
    tanks
      .filter((t) => t.status === 'available')
      .forEach((t) => {
        const key = t.gasType
        map[key] = (map[key] ?? 0) + 1
      })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [tanks])

  // Low stock: gas types with < 3 available
  const lowStock = availableByGas.filter(([, count]) => count < 3)

  return (
    <div className="inv-page">
      {/* Header */}
      <div className="inv-header">
        <div className="inv-header__left">
          <h1 className="inv-header__title">Inventory</h1>
          {!loading && (
            <span className="inv-header__meta">{tanks.length} cylinders total</span>
          )}
        </div>
        <div className="inv-header__actions">
          <Button size="sm" onClick={() => navigate(`${opsBase}/tanks`)}>
            Manage Cylinders
          </Button>
        </div>
      </div>

      {/* Status summary cards */}
      <section>
        <h2 className="inv-section-title">By Status</h2>
        <div className="inv-status-grid">
          {ALL_STATUSES.map((status) => (
            <button
              key={status}
              className="inv-status-card"
              style={{ '--status-color': STATUS_COLORS[status] } as React.CSSProperties}
              onClick={() => navigate(`${opsBase}/tanks`, { state: { filterStatus: status } })}
            >
              <div className="inv-status-card__count">
                {loading ? '—' : statusCounts[status]}
              </div>
              <div className="inv-status-card__label">{STATUS_LABELS[status]}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Available by gas type */}
      <section>
        <div className="inv-section-header">
          <h2 className="inv-section-title">Available Stock by Gas Type</h2>
          {lowStock.length > 0 && (
            <span className="inv-low-stock-badge">
              {lowStock.length} low stock
            </span>
          )}
        </div>
        {loading ? (
          <div className="inv-empty">Loading…</div>
        ) : availableByGas.length === 0 ? (
          <div className="inv-empty">No available cylinders in warehouse.</div>
        ) : (
          <div className="inv-gas-grid">
            {availableByGas.map(([gasType, count]) => {
              const isLow = count < 3
              return (
                <div
                  key={gasType}
                  className={`inv-gas-card ${isLow ? 'inv-gas-card--low' : ''}`}
                >
                  <div className="inv-gas-card__count">{count}</div>
                  <div className="inv-gas-card__label">{capitalize(gasType)}</div>
                  {isLow && <div className="inv-gas-card__alert">Low stock</div>}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Inspection alerts */}
      <section>
        <div className="inv-section-header">
          <h2 className="inv-section-title">Inspection Alerts</h2>
          <span className="inv-section-sub">
            Cylinders overdue or due within 30 days
          </span>
        </div>
        {inspectionDue.length === 0 ? (
          <div className="inv-empty inv-empty--success">
            No cylinders overdue for inspection.
          </div>
        ) : (
          <div className="inv-inspection-table-wrap">
            <table className="inv-table">
              <thead>
                <tr>
                  <th className="inv-th">Serial #</th>
                  <th className="inv-th">Gas Type</th>
                  <th className="inv-th">Size</th>
                  <th className="inv-th">Status</th>
                  <th className="inv-th">Last Inspection</th>
                  <th className="inv-th">Next Due</th>
                  <th className="inv-th inv-th--actions">Action</th>
                </tr>
              </thead>
              <tbody>
                {inspectionDue.map((tank) => {
                  const nextDue = tank.nextInspectionDate?.toDate?.()
                  const now = new Date()
                  const isOverdue = nextDue ? nextDue < now : false
                  return (
                    <tr key={tank.id} className={`inv-row ${isOverdue ? 'inv-row--overdue' : 'inv-row--due-soon'}`}>
                      <td className="inv-td inv-td--serial">{tank.serialNumber}</td>
                      <td className="inv-td">{capitalize(tank.gasType)}</td>
                      <td className="inv-td">{tank.sizeLabel}</td>
                      <td className="inv-td">
                        <span className={`inv-status-pill inv-status-pill--${tank.status}`}>
                          {STATUS_LABELS[tank.status]}
                        </span>
                      </td>
                      <td className="inv-td inv-td--date">{fmtDate(tank.lastInspectionDate)}</td>
                      <td className="inv-td inv-td--date">
                        <span className={isOverdue ? 'inv-overdue-label' : 'inv-due-soon-label'}>
                          {fmtDate(tank.nextInspectionDate)}
                          {isOverdue && ' — Overdue'}
                        </span>
                      </td>
                      <td className="inv-td">
                        <button
                          className="inv-link-btn"
                          onClick={() => navigate(`${opsBase}/tanks`, { state: { highlightId: tank.id } })}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
