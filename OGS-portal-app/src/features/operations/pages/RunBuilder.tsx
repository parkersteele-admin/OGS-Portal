/**
 * RunBuilder.tsx
 * 4-step wizard for building and creating a dispatch run.
 * BEM prefix: rb-
 *
 * Step 1 — Run setup: name/notes, date, driver, truck
 * Step 2 — Select orders: pending pool with filters + checkboxes
 * Step 3 — Optimize route: sort heuristic + drag-to-reorder
 * Step 4 — Review + create: final confirmation → Firestore + driver notification
 */

import React, { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  writeBatch,
  doc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import { runStopsCol } from '../../../lib/firestore'
import { usePendingOrders } from '../../../hooks/usePendingOrders'
import { useRunBuilderData } from '../../../hooks/useRunBuilderData'
import { createRun } from '../../../services/runService'
import { updateOrder } from '../../../services/orderService'
import { getActiveRunAssignableUsers } from '../../../services/userService'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import type { Order, DeliveryTier } from '../../../types/order'
import type { Customer } from '../../../types/customer'
import type { Product } from '../../../types/product'
import type { AppUser } from '../../../types/user'
import './RunBuilder.css'

// ── Types ─────────────────────────────────────────────────────────────────────

interface StopItem {
  orderId: string
  customerId: string
  tankId?: string
  customerName: string
  address: string
  city: string
  zip: string
  productName: string
  quantity: number
  tier: DeliveryTier
}

interface Setup {
  name: string
  date: string       // YYYY-MM-DD
  driverId: string
  truckId: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function defaultRunName(dateStr: string): string {
  if (!dateStr) return 'New Run'
  const d = new Date(dateStr + 'T12:00:00')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `Run ${mm}/${dd}`
}

function isRush(tier: DeliveryTier): boolean {
  return tier === 'same-day' || tier === 'next-day'
}

function tierVariant(tier: DeliveryTier): 'danger' | 'warning' | 'neutral' {
  if (tier === 'same-day') return 'danger'
  if (tier === 'next-day') return 'warning'
  return 'neutral'
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function isSameLocalDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  )
}

// ── StepIndicator ─────────────────────────────────────────────────────────────

const STEP_LABELS = ['Setup', 'Select orders', 'Route', 'Review']

const StepIndicator: React.FC<{ current: number }> = ({ current }) => (
  <div className="rb-steps">
    {STEP_LABELS.map((label, i) => {
      const n = i + 1
      const done   = n < current
      const active = n === current
      return (
        <React.Fragment key={n}>
          <div className={`rb-step${done ? ' rb-step--done' : ''}${active ? ' rb-step--active' : ''}`}>
            <div className="rb-step__badge">
              {done ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              ) : n}
            </div>
            <span className="rb-step__label">{label}</span>
          </div>
          {i < STEP_LABELS.length - 1 && (
            <div className={`rb-step__line${done ? ' rb-step__line--done' : ''}`} />
          )}
        </React.Fragment>
      )
    })}
  </div>
)

// ── Step 1: Setup ─────────────────────────────────────────────────────────────

interface Step1Props {
  setup: Setup
  onChange: (s: Setup) => void
  onNext: () => void
  drivers: AppUser[]
  driversLoading: boolean
}

const Step1Setup: React.FC<Step1Props> = ({ setup, onChange, onNext, drivers, driversLoading }) => {
  function set<K extends keyof Setup>(k: K, v: Setup[K]) {
    onChange({ ...setup, [k]: v })
  }

  function handleDateChange(val: string) {
    const autoName = defaultRunName(setup.date)
    if (!setup.name || setup.name === autoName || setup.name === defaultRunName('')) {
      onChange({ ...setup, date: val, name: defaultRunName(val) })
    } else {
      set('date', val)
    }
  }

  const valid = setup.date && setup.driverId

  return (
    <div className="rb-body">
      <h2 className="rb-body__title">Run setup</h2>

      <div className="rb-form-grid">
        {/* Run name */}
        <div className="rb-field rb-field--full">
          <label className="rb-label" htmlFor="rb-name">
            Run name <span className="rb-label--hint">(optional · saved as notes)</span>
          </label>
          <input
            id="rb-name"
            type="text"
            className="rb-input"
            value={setup.name}
            onChange={e => set('name', e.target.value)}
            placeholder={defaultRunName(setup.date || todayIso())}
            maxLength={120}
          />
        </div>

        {/* Date */}
        <div className="rb-field">
          <label className="rb-label" htmlFor="rb-date">
            Scheduled date <span className="rb-label--required">*</span>
          </label>
          <input
            id="rb-date"
            type="date"
            className="rb-input"
            value={setup.date}
            min={todayIso()}
            onChange={e => handleDateChange(e.target.value)}
            required
          />
        </div>

        {/* Driver */}
        <div className="rb-field">
          <label className="rb-label" htmlFor="rb-driver">
            Driver <span className="rb-label--required">*</span>
          </label>
          <select
            id="rb-driver"
            className="rb-input rb-select"
            value={setup.driverId}
            onChange={e => set('driverId', e.target.value)}
            required
            disabled={driversLoading}
          >
            <option value="">{driversLoading ? 'Loading…' : 'Select driver'}</option>
            {drivers.map(d => (
              <option key={d.id} value={d.id}>{d.name} ({d.role})</option>
            ))}
          </select>
        </div>

        {/* Truck */}
        <div className="rb-field">
          <label className="rb-label" htmlFor="rb-truck">
            Truck / vehicle <span className="rb-label--hint">(optional)</span>
          </label>
          <input
            id="rb-truck"
            type="text"
            className="rb-input"
            value={setup.truckId}
            onChange={e => set('truckId', e.target.value)}
            placeholder="e.g. Truck 3, OGS-P1"
            maxLength={60}
          />
        </div>
      </div>

      <div className="rb-nav">
        <Button variant="primary" onClick={onNext} disabled={!valid}>
          Next: Select orders →
        </Button>
      </div>
    </div>
  )
}

// ── Step 2: Order selection ───────────────────────────────────────────────────

interface Step2Props {
  orders: Order[]
  loading: boolean
  selected: Set<string>
  onToggle: (id: string) => void
  onToggleAll: (ids: string[]) => void
  customerMap: Record<string, Customer>
  productMap: Record<string, Product>
  onBack: () => void
  onNext: () => void
}

const Step2Orders: React.FC<Step2Props> = ({
  orders, loading, selected, onToggle, onToggleAll,
  customerMap, productMap, onBack, onNext,
}) => {
  const [filterProduct, setFilterProduct] = useState('')
  const [filterZip,     setFilterZip]     = useState('')

  const sorted = [...orders].sort((a, b) =>
    (isRush(a.deliveryTier) ? 0 : 1) - (isRush(b.deliveryTier) ? 0 : 1)
  )

  const filtered = sorted.filter(o => {
    const prod = productMap[o.productId]
    const cust = customerMap[o.customerId]
    if (filterProduct && !(prod?.name ?? '').toLowerCase().includes(filterProduct.toLowerCase())) return false
    if (filterZip && !(cust?.zip ?? '').startsWith(filterZip)) return false
    return true
  })

  const filteredIds = filtered.map(o => o.id)
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every(id => selected.has(id))

  const totalQty = [...selected].reduce((s, id) => {
    const o = orders.find(x => x.id === id)
    return s + (o?.quantity ?? 0)
  }, 0)

  const productNames = [
    ...new Set(orders.map(o => productMap[o.productId]?.name).filter(Boolean) as string[])
  ].sort()

  const fmtTs = (ts: Order['requestedAt']) => {
    if (!ts || typeof ts.toDate !== 'function') return '—'
    return ts.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <div className="rb-body">
      <div className="rb-body__header">
        <h2 className="rb-body__title">Select orders</h2>
        {selected.size > 0 && (
          <div className="rb-selection-pill">
            <span>{selected.size} orders</span>
            <span className="rb-selection-pill__sep">·</span>
            <span>{totalQty} total units</span>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="rb-filters">
        <div className="rb-filter">
          <label className="rb-label" htmlFor="rb-f-product">Product</label>
          <select
            id="rb-f-product"
            className="rb-input rb-select rb-input--sm"
            value={filterProduct}
            onChange={e => setFilterProduct(e.target.value)}
          >
            <option value="">All products</option>
            {productNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="rb-filter">
          <label className="rb-label" htmlFor="rb-f-zip">Zip prefix</label>
          <input
            id="rb-f-zip"
            type="text"
            className="rb-input rb-input--sm"
            value={filterZip}
            onChange={e => setFilterZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
            placeholder="e.g. 432"
            maxLength={5}
          />
        </div>
        {(filterProduct || filterZip) && (
          <button
            className="rb-filter-clear"
            onClick={() => { setFilterProduct(''); setFilterZip('') }}
          >
            ✕ Clear
          </button>
        )}
      </div>

      {loading ? (
        <div className="rb-empty">Loading orders…</div>
      ) : orders.length === 0 ? (
        <div className="rb-empty">
          <span className="rb-empty__icon">✓</span>
          <p>No pending orders</p>
        </div>
      ) : (
        <div className="rb-table-wrap">
          <table className="rb-table">
            <thead>
              <tr>
                <th className="rb-table__check">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={() => onToggleAll(filteredIds)}
                    aria-label="Select all"
                  />
                </th>
                <th>Customer</th>
                <th>Address</th>
                <th>Product</th>
                <th>Qty</th>
                <th>Tier</th>
                <th>Requested</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(order => {
                const cust = customerMap[order.customerId]
                const prod = productMap[order.productId]
                const rush = isRush(order.deliveryTier)
                return (
                  <tr
                    key={order.id}
                    className={`rb-table__row${rush ? ' rb-table__row--rush' : ''}${selected.has(order.id) ? ' rb-table__row--selected' : ''}`}
                    onClick={() => onToggle(order.id)}
                  >
                    <td className="rb-table__check" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(order.id)}
                        onChange={() => onToggle(order.id)}
                        aria-label={`Select order for ${cust?.name ?? order.customerId}`}
                      />
                    </td>
                    <td className="rb-table__customer">
                      {rush && <span className="rb-rush-dot" aria-hidden="true" />}
                      {cust?.name ?? order.customerId}
                    </td>
                    <td className="rb-table__address">
                      <span>{cust?.address ?? '—'}</span>
                      {cust && <span className="rb-table__zip">{cust.city}, {cust.state} {cust.zip}</span>}
                    </td>
                    <td className="rb-table__product">{prod?.name ?? order.productId}</td>
                    <td className="rb-table__qty">{order.quantity} {prod?.unit ?? ''}</td>
                    <td><Badge variant={tierVariant(order.deliveryTier)}>{order.deliveryTier}</Badge></td>
                    <td className="rb-table__date">{fmtTs(order.requestedAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {filtered.length === 0 && (
            <div className="rb-table-empty">No orders match the current filters.</div>
          )}
        </div>
      )}

      <div className="rb-nav">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <Button variant="primary" onClick={onNext} disabled={selected.size === 0}>
          Next: Route ({selected.size} selected) →
        </Button>
      </div>
    </div>
  )
}

// ── Step 3: Route optimizer ───────────────────────────────────────────────────

interface Step3Props {
  stops: StopItem[]
  setStops: (stops: StopItem[]) => void
  availableOrders: Order[]
  customerMap: Record<string, Customer>
  productMap: Record<string, Product>
  onAddOrders: (orderIds: string[]) => void
  onRemoveOrder: (orderId: string) => void
  onBack: () => void
  onNext: () => void
}

const Step3Route: React.FC<Step3Props> = ({
  stops,
  setStops,
  availableOrders,
  customerMap,
  productMap,
  onAddOrders,
  onRemoveOrder,
  onBack,
  onNext,
}) => {
  const [optimized,  setOptimized]  = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [dragIdx,    setDragIdx]    = useState<number | null>(null)
  const [dragOver,   setDragOver]   = useState<number | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [orderSearch, setOrderSearch] = useState('')
  const [modalSelected, setModalSelected] = useState<Set<string>>(new Set())

  function handleOptimize() {
    setOptimizing(true)
    // Route heuristic: rush stops first, then by zip code proximity
    setTimeout(() => {
      const rush     = stops.filter(s => isRush(s.tier))
      const standard = stops.filter(s => !isRush(s.tier)).sort((a, b) => a.zip.localeCompare(b.zip))
      setStops([...rush, ...standard])
      setOptimizing(false)
      setOptimized(true)
    }, 900)
  }

  function handleDragStart(i: number) { setDragIdx(i) }
  function handleDragOver(e: React.DragEvent, i: number) {
    e.preventDefault()
    setDragOver(i)
  }
  function handleDrop(i: number) {
    if (dragIdx === null || dragIdx === i) { setDragIdx(null); setDragOver(null); return }
    const next = [...stops]
    const [moved] = next.splice(dragIdx, 1)
    next.splice(i, 0, moved)
    setStops(next)
    setDragIdx(null)
    setDragOver(null)
  }
  function handleDragEnd() { setDragIdx(null); setDragOver(null) }

  const filteredAvailableOrders = availableOrders.filter((order) => {
    const customer = customerMap[order.customerId]
    const product = productMap[order.productId]
    const haystack = [
      customer?.name,
      customer?.address,
      customer?.city,
      customer?.zip,
      product?.name,
      order.id,
      order.groupId,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(orderSearch.trim().toLowerCase())
  })

  function toggleModalOrder(orderId: string) {
    setModalSelected((prev) => {
      const next = new Set(prev)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  function handleAddSelectedOrders() {
    const ids = [...modalSelected]
    if (ids.length === 0) return
    onAddOrders(ids)
    setModalSelected(new Set())
    setOrderSearch('')
    setShowAddModal(false)
  }

  return (
    <div className="rb-body">
      <div className="rb-body__header">
        <div>
          <h2 className="rb-body__title">Optimize route</h2>
          <p className="rb-body__sub">{stops.length} stops · drag rows to reorder manually</p>
        </div>
        <div className="rb-body__actions">
          <Button variant="secondary" size="sm" onClick={() => setShowAddModal(true)}>
            + Add order
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={optimizing}
            disabled={optimizing}
            onClick={handleOptimize}
          >
            {optimizing ? 'Calculating…' : optimized ? '↻ Re-optimize' : '✦ Optimize route'}
          </Button>
        </div>
      </div>

      {optimizing && (
        <div className="rb-optimize-status">
          <span className="rb-spinner" aria-hidden="true" />
          Calculating best route by area…
        </div>
      )}

      {optimized && !optimizing && (
        <div className="rb-optimize-ok">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          Rush stops first, then sorted by area (zip)
        </div>
      )}

      <div className="rb-route-wrap">
        {/* SVG route diagram */}
        <div className="rb-route-diagram" aria-hidden="true">
          <svg
            viewBox={`0 0 56 ${Math.max(80, stops.length * 48)}`}
            width="56"
            height={Math.max(80, stops.length * 48)}
          >
            {stops.length > 1 && (
              <line
                x1="28" y1="24"
                x2="28" y2={24 + (stops.length - 1) * 48}
                stroke="var(--color-border-2)"
                strokeWidth="2"
                strokeDasharray="4 3"
              />
            )}
            {stops.map((s, i) => {
              const cy = 24 + i * 48
              const isFirst = i === 0
              const isLast  = i === stops.length - 1
              const fill = isFirst ? 'var(--color-brand)'
                : isLast ? 'var(--color-success)'
                : isRush(s.tier) ? '#FBBF24'
                : 'var(--color-bg-3)'
              const textFill = (isFirst || isLast) ? 'white' : 'var(--color-text)'
              return (
                <g key={s.orderId} transform={`translate(28, ${cy})`}>
                  <circle r="15" fill={fill} stroke="var(--color-border)" strokeWidth="1.5" />
                  <text x="0" y="5" textAnchor="middle" fontSize="11" fontWeight="700" fill={textFill}>
                    {i + 1}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>

        {/* Draggable stop list */}
        <ul className="rb-stop-list">
          {stops.map((stop, i) => (
            <li
              key={stop.orderId}
              className={[
                'rb-stop-item',
                dragIdx === i       ? 'rb-stop-item--dragging'  : '',
                dragOver === i && dragIdx !== i ? 'rb-stop-item--drag-over' : '',
                isRush(stop.tier)   ? 'rb-stop-item--rush'      : '',
              ].filter(Boolean).join(' ')}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={e => handleDragOver(e, i)}
              onDrop={() => handleDrop(i)}
              onDragEnd={handleDragEnd}
            >
              <span className="rb-stop-item__handle" aria-hidden="true">⠿</span>
              <div className="rb-stop-item__info">
                <span className="rb-stop-item__name">{stop.customerName}</span>
                <span className="rb-stop-item__addr">
                  {stop.address}{stop.city ? ` · ${stop.city}` : ''}{stop.zip ? ` ${stop.zip}` : ''}
                </span>
              </div>
              <div className="rb-stop-item__meta">
                <span className="rb-stop-item__product">{stop.productName} × {stop.quantity}</span>
                <Badge variant={tierVariant(stop.tier)}>{stop.tier}</Badge>
                <button
                  type="button"
                  className="rb-stop-item__remove"
                  onClick={() => onRemoveOrder(stop.orderId)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="rb-nav">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <Button variant="primary" onClick={onNext}>Looks good →</Button>
      </div>

      <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="Add Pending Orders" size="lg">
        <div className="rb-add-order-modal">
          <input
            type="search"
            className="rb-input"
            value={orderSearch}
            onChange={(e) => setOrderSearch(e.target.value)}
            placeholder="Search customer, order #, address, or product"
          />
          <div className="rb-add-order-list">
            {filteredAvailableOrders.length === 0 ? (
              <div className="rb-table-empty">No pending orders match the current search.</div>
            ) : (
              filteredAvailableOrders.map((order) => {
                const customer = customerMap[order.customerId]
                const product = productMap[order.productId]
                const summary = order.quotedLineItems?.length
                  ? order.quotedLineItems.map((item) => `${item.description} x${item.quantity}`).join(' | ')
                  : `${product?.name ?? order.productId} x ${order.quantity}`
                return (
                  <label key={order.id} className="rb-add-order-row">
                    <input
                      type="checkbox"
                      checked={modalSelected.has(order.id)}
                      onChange={() => toggleModalOrder(order.id)}
                    />
                    <div className="rb-add-order-row__main">
                      <div className="rb-add-order-row__title">
                        <span>{customer?.name ?? order.customerId}</span>
                        <span className="rb-add-order-row__order">#{order.id.slice(0, 8).toUpperCase()}</span>
                      </div>
                      <div className="rb-add-order-row__sub">
                        {[customer?.address, customer?.city, customer?.state, customer?.zip].filter(Boolean).join(', ')}
                      </div>
                      <div className="rb-add-order-row__meta">{summary}</div>
                    </div>
                  </label>
                )
              })
            )}
          </div>
          <div className="rb-add-order-actions">
            <Button variant="secondary" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleAddSelectedOrders} disabled={modalSelected.size === 0}>
              Add Selected
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ── Step 4: Review + Create ───────────────────────────────────────────────────

interface Step4Props {
  setup: Setup
  stops: StopItem[]
  drivers: AppUser[]
  onBack: () => void
  onCreate: () => Promise<void>
  creating: boolean
  error: string | null
}

const Step4Review: React.FC<Step4Props> = ({
  setup, stops, drivers, onBack, onCreate, creating, error,
}) => {
  const driver = drivers.find(d => d.id === setup.driverId)

  return (
    <div className="rb-body">
      <h2 className="rb-body__title">Review & create</h2>

      {/* Summary */}
      <div className="rb-summary-card">
        <div className="rb-summary-row">
          <span className="rb-summary-label">Run name</span>
          <span className="rb-summary-value">{setup.name || defaultRunName(setup.date)}</span>
        </div>
        <div className="rb-summary-row">
          <span className="rb-summary-label">Date</span>
          <span className="rb-summary-value">{fmtDate(setup.date)}</span>
        </div>
        <div className="rb-summary-row">
          <span className="rb-summary-label">Driver</span>
          <span className="rb-summary-value">{driver?.name ?? '—'}</span>
        </div>
        {setup.truckId && (
          <div className="rb-summary-row">
            <span className="rb-summary-label">Truck</span>
            <span className="rb-summary-value">{setup.truckId}</span>
          </div>
        )}
        <div className="rb-summary-row">
          <span className="rb-summary-label">Total stops</span>
          <span className="rb-summary-value">{stops.length}</span>
        </div>
      </div>

      <h3 className="rb-review-stops-title">Stop order</h3>
      <ol className="rb-review-stops">
        {stops.map((stop, i) => (
          <li
            key={stop.orderId}
            className={`rb-review-stop${isRush(stop.tier) ? ' rb-review-stop--rush' : ''}`}
          >
            <span className="rb-review-stop__num">{i + 1}</span>
            <div className="rb-review-stop__main">
              <span className="rb-review-stop__name">{stop.customerName}</span>
              <span className="rb-review-stop__addr">{stop.address}{stop.city ? `, ${stop.city}` : ''}</span>
            </div>
            <div className="rb-review-stop__right">
              <span className="rb-review-stop__product">{stop.productName} × {stop.quantity}</span>
              <Badge variant={tierVariant(stop.tier)}>{stop.tier}</Badge>
            </div>
          </li>
        ))}
      </ol>

      {error && (
        <div className="rb-error" role="alert">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {error}
        </div>
      )}

      <div className="rb-nav">
        <Button variant="ghost" onClick={onBack} disabled={creating}>← Back</Button>
        <Button variant="primary" loading={creating} onClick={onCreate}>
          Create run
        </Button>
      </div>
    </div>
  )
}

// ── RunBuilder (main) ─────────────────────────────────────────────────────────

export default function RunBuilder() {
  const navigate = useNavigate()
  const location = useLocation()

  const preselectedIds = (
    location.state as { selectedOrderIds?: string[] } | null
  )?.selectedOrderIds ?? []

  const today = todayIso()

  // Step state
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)

  // Step 1: Setup
  const [setup, setSetup] = useState<Setup>({
    name:     defaultRunName(today),
    date:     today,
    driverId: '',
    truckId:  '',
  })

  // Remote data
  const { customerMap, productMap } = useRunBuilderData()
  const { orders: pendingOrders, loading: ordersLoading } = usePendingOrders()
  const [drivers, setDrivers] = useState<AppUser[]>([])
  const [driversLoading, setDriversLoading] = useState(true)

  // Step 2: Selection
  const [selected, setSelected] = useState<Set<string>>(new Set(preselectedIds))

  // Step 3: Stop order (derived + drag-reorderable)
  const [stops, setStops] = useState<StopItem[]>([])

  // Step 4: Create state
  const [creating,     setCreating]     = useState(false)
  const [createError,  setCreateError]  = useState<string | null>(null)

  // ── Data loading ────────────────────────────────────────────────────────────

  useEffect(() => {
    getActiveRunAssignableUsers()
      .then(ds => { 
        setDrivers(ds); 
        setDriversLoading(false) 
      })
      .catch((err) => {
        console.error('[RunBuilder] Failed to load users:', err);
        setDriversLoading(false);
      })
  }, [])

  // ── Selection helpers ───────────────────────────────────────────────────────

  function toggleOrder(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function toggleAll(ids: string[]) {
    setSelected(prev => {
      const next   = new Set(prev)
      const allIn  = ids.every(id => next.has(id))
      if (allIn) {
        ids.forEach(id => next.delete(id))
      } else {
        ids.forEach(id => next.add(id))
      }
      return next
    })
  }

  // ── Step transitions ────────────────────────────────────────────────────────

  function buildStops(): StopItem[] {
    return pendingOrders
      .filter(o => selected.has(o.id))
      .sort((a, b) =>
        (isRush(a.deliveryTier) ? 0 : 1) - (isRush(b.deliveryTier) ? 0 : 1)
      )
      .map(o => {
        const cust = customerMap[o.customerId]
        const prod = productMap[o.productId]
        return {
          orderId:      o.id,
          customerId:   o.customerId,
          tankId:       o.tankId,
          customerName: cust?.name  ?? o.customerId,
          address:      cust?.address ?? '',
          city:         cust?.city    ?? '',
          zip:          cust?.zip     ?? '',
          productName:  prod?.name ?? o.productId,
          quantity:     o.quantity,
          tier:         o.deliveryTier,
        }
      })
  }

  function goToStep2() { setStep(2) }
  function goToStep3() { setStops(buildStops()); setStep(3) }
  function goToStep4() { setStep(4) }

  function addOrdersToRun(orderIds: string[]) {
    setSelected((prev) => {
      const next = new Set(prev)
      orderIds.forEach((id) => next.add(id))
      return next
    })
    const stopMap = new Map(stops.map((stop) => [stop.orderId, stop]))
    const additions = pendingOrders
      .filter((order) => orderIds.includes(order.id) && !stopMap.has(order.id))
      .map((order) => {
        const customer = customerMap[order.customerId]
        const product = productMap[order.productId]
        return {
          orderId: order.id,
          customerId: order.customerId,
          tankId: order.tankId,
          customerName: customer?.name ?? order.customerId,
          address: customer?.address ?? '',
          city: customer?.city ?? '',
          zip: customer?.zip ?? '',
          productName: product?.name ?? order.productId,
          quantity: order.quantity,
          tier: order.deliveryTier,
        } satisfies StopItem
      })
    setStops([...stops, ...additions])
  }

  function removeOrderFromRun(orderId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(orderId)
      return next
    })
    setStops((prev) => prev.filter((stop) => stop.orderId !== orderId))
  }

  // ── Create ──────────────────────────────────────────────────────────────────

  async function handleCreate() {
    setCreating(true)
    setCreateError(null)

    try {
      // 1. Create run document
      const runId = await createRun({
        driverId:      setup.driverId,
        truckId:       setup.truckId   || undefined,
        scheduledDate: new Date(setup.date + 'T08:00:00'),
        notes:         setup.name      || undefined,
      })

      // 2. Batch-create all stops + update run.stopIds in one round-trip
      const batch    = writeBatch(db)
      const stopRefs = stops.map(() => doc(runStopsCol(runId)))
      const stopIds  = stopRefs.map(r => r.id)

      stops.forEach((stop, i) => {
        batch.set(stopRefs[i], {
          runId,
          order:      i + 1,
          orderId:    stop.orderId,
          customerId: stop.customerId,
          ...(stop.tankId ? { tankId: stop.tankId } : {}),
          status:     'pending',
        } as never)
      })

      batch.update(doc(db, 'runs', runId), {
        stopIds,
        updatedAt: serverTimestamp(),
      })

      await batch.commit()

      // 3. Mark each order as scheduled
      const scheduledDate = new Date(setup.date + 'T08:00:00')
      const deliveryDayStatus = isSameLocalDate(scheduledDate, new Date())
        ? 'in_transit'
        : 'scheduled'

      await Promise.all(
        stops.map((stop, index) =>
          updateOrder(stop.orderId, {
            status:      deliveryDayStatus,
            scheduledAt: serverTimestamp() as never,
            runId,
            runStopId: stopRefs[index].id,
          })
        )
      )

      // 4. Navigate to dispatch map for this run
      // (driver notification is sent server-side by the onRunCreated Cloud Function)
      navigate('/ops/dispatch', { state: { runId }, replace: true })

    } catch (err: unknown) {
      setCreateError(
        err instanceof Error ? err.message : 'Failed to create run. Please try again.'
      )
    } finally {
      setCreating(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="rb-page">
      {/* Page header */}
      <div className="rb-page__header">
        <button className="rb-back-btn" onClick={() => navigate(-1)}>
          ← Runs
        </button>
        <h1 className="rb-page__title">Build run</h1>
      </div>

      <StepIndicator current={step} />

      <div className="rb-card">
        {step === 1 && (
          <Step1Setup
            setup={setup}
            onChange={setSetup}
            onNext={goToStep2}
            drivers={drivers}
            driversLoading={driversLoading}
          />
        )}
        {step === 2 && (
          <Step2Orders
            orders={pendingOrders}
            loading={ordersLoading}
            selected={selected}
            onToggle={toggleOrder}
            onToggleAll={toggleAll}
            customerMap={customerMap}
            productMap={productMap}
            onBack={() => setStep(1)}
            onNext={goToStep3}
          />
        )}
        {step === 3 && (
          <Step3Route
            stops={stops}
            setStops={setStops}
            availableOrders={pendingOrders.filter((order) => !selected.has(order.id))}
            customerMap={customerMap}
            productMap={productMap}
            onAddOrders={addOrdersToRun}
            onRemoveOrder={removeOrderFromRun}
            onBack={() => setStep(2)}
            onNext={goToStep4}
          />
        )}
        {step === 4 && (
          <Step4Review
            setup={setup}
            stops={stops}
            drivers={drivers}
            onBack={() => setStep(3)}
            onCreate={handleCreate}
            creating={creating}
            error={createError}
          />
        )}
      </div>
    </div>
  )
}
