/**
 * src/pages/dispatch/TankInventory.tsx
 * BEM prefix: ti-
 *
 * Ops tank & cylinder inventory management at /ops/tanks.
 *
 * Sections:
 *   1. Warehouse stock summary cards (per gasType+size group)
 *   2. Low level alert list (deployed tanks < 25%)
 *   3. Cylinder tabs (All | Available | Deployed | Returned | Inspection)
 *   4. Cylinder table with inline level edit, status change, detail panel
 *
 * Modals / panels:
 *   - Add cylinder modal
 *   - Cylinder detail slide-in (docs, level visual, rental info)
 *   - Create refill order mini-modal
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  onSnapshot,
  query,
  orderBy,
  getDoc,
  getDocs,
  where,
  doc,
} from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import { tanksCol, productsCol } from '../../../lib/firestore'
import { ProductCombobox } from '../../../components/ui/ProductCombobox'
import type { ProductDropdownItem } from '../../../services/productService'
import {
  createTank,
  updateTank,
  updateTankLevel,
  transitionTankStatus,
  canTransition,
} from '../../../services/tankService'
import {
  uploadFile,
  getFilesForEntity,
} from '../../../services/fileService'
import { createOrder } from '../../../services/orderService'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import type { Tank, TankStatus } from '../../../types/tank'
import type { Customer } from '../../../types/customer'
import type { Product } from '../../../types/product'
import type { AppFile } from '../../../types/file'
import type { DeliveryTier } from '../../../types/order'
import './TankInventory.css'
import * as XLSX from 'xlsx'
import { QRCodeSVG } from 'qrcode.react'
import { subscribeToTankEvents } from '../../../services/tankService'
import type { TankEvent } from '../../../types/tank'

// ── Constants ──────────────────────────────────────────────────────────────────

const MIN_AVAILABLE_THRESHOLD = 3  // warn if available count drops below this
const LOW_LEVEL_THRESHOLD = 25     // % — show in alert section

const STATUS_LABELS: Record<TankStatus, string> = {
  available:  'Available',
  on_truck:   'On Truck',
  deployed:   'Deployed',
  returned:   'Returned',
  inspection: 'Inspection',
}

const ALL_TRANSITIONS: TankStatus[] = ['available', 'deployed', 'returned', 'inspection']

type TabKey = 'all' | TankStatus

// ── Helpers ────────────────────────────────────────────────────────────────────

function daysUntil(ts: { toDate?: () => Date } | null | undefined): number | null {
  if (!ts?.toDate) return null
  const ms = ts.toDate().getTime() - Date.now()
  return Math.ceil(ms / 86_400_000)
}

function fmtDate(ts: { toDate?: () => Date } | null | undefined): string {
  if (!ts?.toDate) return '—'
  return ts.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)
}

// ── Inspection badge ───────────────────────────────────────────────────────────

function InspectionBadge({ tank }: { tank: Tank }) {
  const days = daysUntil(tank.nextInspectionDate)
  if (days === null) return <span className="ti-insp-badge ti-insp-badge--none">No date</span>
  if (days < 0)      return <span className="ti-insp-badge ti-insp-badge--red">Overdue</span>
  if (days <= 30)    return <span className="ti-insp-badge ti-insp-badge--amber">≤ 30 days</span>
  return <span className="ti-insp-badge ti-insp-badge--green">{days}d</span>
}

// ── Level bar ──────────────────────────────────────────────────────────────────

function LevelBar({ pct, size = 'sm' }: { pct?: number; size?: 'sm' | 'md' }) {
  if (pct === undefined || pct === null) {
    return <span className="ti-level-na">—</span>
  }
  const cls = pct <= 15 ? 'ti-level-bar__fill--danger'
            : pct <= 30 ? 'ti-level-bar__fill--warning'
            : 'ti-level-bar__fill--ok'
  return (
    <div className={`ti-level-bar ti-level-bar--${size}`}>
      <div className={`ti-level-bar__fill ${cls}`} style={{ width: `${pct}%` }} />
      <span className="ti-level-bar__label">{pct}%</span>
    </div>
  )
}

// ── Stock summary cards ────────────────────────────────────────────────────────

interface StockGroup {
  key: string
  gasType: string
  sizeLabel: string
  available:  number
  on_truck:   number
  deployed:   number
  inspection: number
  returned:   number
}

function StockCard({ group }: { group: StockGroup }) {
  const warn = group.available < MIN_AVAILABLE_THRESHOLD
  return (
    <div className={`ti-stock-card ${warn ? 'ti-stock-card--warn' : ''}`}>
      {warn && (
        <div className="ti-stock-card__warn-badge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 20h20L12 2zm1 15h-2v2h2v-2zm0-6h-2v6h2v-6z"/></svg>
          Low Stock
        </div>
      )}
      <div className="ti-stock-card__gas">{group.gasType}</div>
      <div className="ti-stock-card__size">{group.sizeLabel}</div>
      <div className="ti-stock-card__counts">
        <div className="ti-stock-card__count ti-stock-card__count--available">
          <span className="ti-stock-card__num">{group.available}</span>
          <span className="ti-stock-card__lbl">Available</span>
        </div>
        <div className="ti-stock-card__count ti-stock-card__count--deployed">
          <span className="ti-stock-card__num">{group.deployed}</span>
          <span className="ti-stock-card__lbl">Deployed</span>
        </div>
        {group.inspection > 0 && (
          <div className="ti-stock-card__count ti-stock-card__count--inspect">
            <span className="ti-stock-card__num">{group.inspection}</span>
            <span className="ti-stock-card__lbl">Inspection</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Low level alert row ────────────────────────────────────────────────────────

interface LowAlertRowProps {
  tank: Tank
  customer?: Customer
  onRefill: (tank: Tank) => void
}

function LowAlertRow({ tank, customer, onRefill }: LowAlertRowProps) {
  return (
    <div className="ti-alert-row">
      <div className="ti-alert-row__info">
        <div className="ti-alert-row__name">{customer?.name ?? '—'}</div>
        <div className="ti-alert-row__serial">{tank.serialNumber} · {tank.gasType} {tank.sizeLabel}</div>
      </div>
      <div className="ti-alert-row__level">
        <LevelBar pct={tank.currentLevelPct} size="md" />
      </div>
      <Button size="sm" onClick={() => onRefill(tank)}>
        Create Refill Order
      </Button>
    </div>
  )
}

// ── Inline level editor ────────────────────────────────────────────────────────

interface QuickLevelEditorProps {
  tank: Tank
  onDone: () => void
}

function QuickLevelEditor({ tank, onDone }: QuickLevelEditorProps) {
  const [val, setVal] = useState(tank.currentLevelPct ?? 0)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await updateTankLevel(tank.id, val)
      onDone()
    } catch {
      setSaving(false)
    }
  }

  return (
    <div className="ti-level-editor" onClick={(e) => e.stopPropagation()}>
      <input
        type="number"
        className="ti-level-editor__input"
        min={0}
        max={100}
        value={val}
        onChange={(e) => setVal(Number(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') onDone()
        }}
        autoFocus
      />
      <span className="ti-level-editor__pct">%</span>
      <button className="ti-level-editor__save" onClick={save} disabled={saving}>
        {saving ? '…' : '✓'}
      </button>
      <button className="ti-level-editor__cancel" onClick={onDone}>
        ✕
      </button>
    </div>
  )
}

// ── Status change menu ─────────────────────────────────────────────────────────

interface StatusMenuProps {
  tank: Tank
  onDone: () => void
}

function StatusMenu({ tank, onDone }: StatusMenuProps) {
  const [saving, setSaving] = useState(false)
  const available = ALL_TRANSITIONS.filter(
    (s) => s !== tank.status && canTransition(tank.status, s),
  )

  if (available.length === 0) {
    return (
      <div className="ti-status-menu" onClick={(e) => e.stopPropagation()}>
        <div className="ti-status-menu__none">No transitions</div>
      </div>
    )
  }

  async function handle(next: TankStatus) {
    setSaving(true)
    try {
      await transitionTankStatus(tank.id, next)
      onDone()
    } catch {
      setSaving(false)
    }
  }

  return (
    <div className="ti-status-menu" onClick={(e) => e.stopPropagation()}>
      {available.map((s) => (
        <button
          key={s}
          className={`ti-status-menu__item ti-status-menu__item--${s}`}
          onClick={() => handle(s)}
          disabled={saving}
        >
          → {STATUS_LABELS[s]}
        </button>
      ))}
    </div>
  )
}

// ── Cylinder table row ─────────────────────────────────────────────────────────

interface CylinderRowProps {
  tank: Tank
  customer?: Customer
  onViewDetail: () => void
  onRefill: () => void
  onEdit: () => void
}

function CylinderRow({ tank, customer, onViewDetail, onRefill, onEdit }: CylinderRowProps) {
  const [editingLevel, setEditingLevel] = useState(false)
  const [showStatus, setShowStatus] = useState(false)

  return (
    <tr
      className={`ti-table__row ti-table__row--${tank.status}`}
      onClick={onViewDetail}
    >
      <td className="ti-table__td">
        <span className="ti-serial">{tank.serialNumber}</span>
      </td>
      <td className="ti-table__td">{tank.gasType}</td>
      <td className="ti-table__td ti-size-cell">
        {tank.sizeLabel}
        <div className="ti-cap-hint">{tank.capacityValue} {tank.capacityUnit}</div>
      </td>
      <td className="ti-table__td" onClick={(e) => { e.stopPropagation(); setShowStatus((v) => !v) }}>
        <div className="ti-status-wrap">
          <span className={`ti-status-badge ti-status-badge--${tank.status}`}>
            {STATUS_LABELS[tank.status]}
          </span>
          <span className="ti-status-caret" title="Change status">▾</span>
          {showStatus && (
            <div className="ti-status-menu-wrap">
              <StatusMenu tank={tank} onDone={() => setShowStatus(false)} />
            </div>
          )}
        </div>
      </td>
      <td className="ti-table__td">
        {customer
          ? <span className="ti-customer-name">{customer.name}</span>
          : <span className="ti-customer-none">—</span>}
      </td>
      <td
        className="ti-table__td ti-table__td--level"
        onClick={(e) => { e.stopPropagation(); if (tank.status === 'deployed') setEditingLevel(true) }}
        title={tank.status === 'deployed' ? 'Click to update level' : undefined}
      >
        {editingLevel
          ? <QuickLevelEditor tank={tank} onDone={() => setEditingLevel(false)} />
          : <LevelBar pct={tank.currentLevelPct} />}
      </td>
      <td className="ti-table__td ti-date-cell">{fmtDate(tank.lastInspectionDate)}</td>
      <td className="ti-table__td">
        <InspectionBadge tank={tank} />
      </td>
      <td
        className="ti-table__td ti-table__td--actions"
        onClick={(e) => e.stopPropagation()}
      >
        {/* View */}
        <button className="ti-action-btn" title="View detail" onClick={onViewDetail} aria-label="View cylinder detail">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="2" />
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
        {/* Edit */}
        <button className="ti-action-btn" title="Edit cylinder" onClick={(e) => { e.stopPropagation(); onEdit() }} aria-label="Edit cylinder">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
        {/* Update level */}
        {tank.status === 'deployed' && (
          <button
            className="ti-action-btn"
            title="Update level"
            onClick={(e) => { e.stopPropagation(); setEditingLevel(true) }}
            aria-label="Update tank level"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M12 20V4M5 13l7 7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {/* Refill order */}
        {tank.status === 'deployed' && (tank.currentLevelPct ?? 100) < LOW_LEVEL_THRESHOLD && (
          <button
            className="ti-action-btn ti-action-btn--warn"
            title="Create refill order"
            onClick={(e) => { e.stopPropagation(); onRefill() }}
            aria-label="Create refill order"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </td>
    </tr>
  )
}

// ── Cylinder detail panel ─────────────────────────────────────────────────────

interface CylinderDetailPanelProps {
  tank: Tank
  customer?: Customer
  onClose: () => void
  onRefill: () => void
  onEdit: () => void
}

function CylinderDetailPanel({ tank, customer, onClose, onRefill, onEdit }: CylinderDetailPanelProps) {
  const [docs, setDocs] = useState<AppFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadPct, setUploadPct] = useState(0)
  const [uploadError, setUploadError] = useState('')
  const [editRate, setEditRate] = useState(false)
  const [rateVal, setRateVal] = useState(String(tank.monthlyRate ?? ''))
  const [savingRate, setSavingRate] = useState(false)
  const [showQR, setShowQR] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getFilesForEntity('tank', tank.id, 'inspection')
      .then(setDocs)
      .catch(() => {})
  }, [tank.id])

  async function handleUpload(file: File) {
    setUploading(true)
    setUploadError('')
    setUploadPct(0)
    try {
      await uploadFile(file, {
        entityType: 'tank',
        entityId: tank.id,
        fileType: 'inspection',
        onProgress: setUploadPct,
      })
      const refreshed = await getFilesForEntity('tank', tank.id, 'inspection')
      setDocs(refreshed)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  async function saveRate() {
    const n = parseFloat(rateVal)
    if (isNaN(n)) return
    setSavingRate(true)
    try {
      await updateTank(tank.id, { monthlyRate: n })
      setEditRate(false)
    } catch {
      /* ignore */
    } finally {
      setSavingRate(false)
    }
  }

  const days = daysUntil(tank.nextInspectionDate)

  return (
    <>
    <div className="ti-panel-overlay" onClick={onClose}>
      <div
        className="ti-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Cylinder ${tank.serialNumber} detail`}
      >
        {/* Header */}
        <div className="ti-panel__header">
          <div>
            <div className="ti-panel__serial">{tank.serialNumber}</div>
            <div className="ti-panel__sub">{tank.gasType} · {tank.sizeLabel}</div>
          </div>
          <button className="ti-panel__close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="ti-panel__body">
          {/* Status + level */}
          <section className="ti-panel__section ti-panel__section--hero">
            <span className={`ti-status-badge ti-status-badge--${tank.status} ti-status-badge--lg`}>
              {STATUS_LABELS[tank.status]}
            </span>
            {tank.status === 'deployed' && (
              <div className="ti-panel__level-wrap">
                <LevelBar pct={tank.currentLevelPct} size="md" />
              </div>
            )}
          </section>

          {/* Basic info */}
          <section className="ti-panel__section">
            <div className="ti-panel__row"><span className="ti-panel__lbl">Customer</span><span>{customer?.name ?? '—'}</span></div>
            {customer && <div className="ti-panel__row"><span className="ti-panel__lbl">Address</span><span>{customer.address}, {customer.city}, {customer.state}</span></div>}
            <div className="ti-panel__row"><span className="ti-panel__lbl">Ownership</span><span className="ti-cap">{tank.ownership ?? 'company'}</span></div>
            <div className="ti-panel__row"><span className="ti-panel__lbl">Capacity</span><span>{tank.capacityValue} {tank.capacityUnit}</span></div>
            <div className="ti-panel__row"><span className="ti-panel__lbl">Notes</span><span>{tank.notes || '—'}</span></div>
          </section>

          {/* Rental */}
          <section className="ti-panel__section">
            <div className="ti-panel__section-title">Rental</div>
            <div className="ti-panel__row">
              <span className="ti-panel__lbl">Start date</span>
              <span>{fmtDate(tank.rentalStartDate)}</span>
            </div>
            <div className="ti-panel__row">
              <span className="ti-panel__lbl">Monthly rate</span>
              {editRate ? (
                <div className="ti-rate-edit">
                  <span className="ti-rate-edit__dollar">$</span>
                  <input
                    className="ti-rate-edit__input"
                    type="number"
                    min={0}
                    step={5}
                    value={rateVal}
                    onChange={(e) => setRateVal(e.target.value)}
                    autoFocus
                  />
                  <button className="ti-rate-edit__save" onClick={saveRate} disabled={savingRate}>✓</button>
                  <button className="ti-rate-edit__cancel" onClick={() => setEditRate(false)}>✕</button>
                </div>
              ) : (
                <span>
                  {tank.monthlyRate ? fmtCurrency(tank.monthlyRate) + '/mo' : '—'}
                  <button className="ti-edit-inline-btn" onClick={() => setEditRate(true)} aria-label="Edit rental rate">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  </button>
                </span>
              )}
            </div>
          </section>

          {/* Inspection */}
          <section className="ti-panel__section">
            <div className="ti-panel__section-title">Inspection</div>
            <div className="ti-panel__row"><span className="ti-panel__lbl">Last</span><span>{fmtDate(tank.lastInspectionDate)}</span></div>
            <div className="ti-panel__row">
              <span className="ti-panel__lbl">Next due</span>
              <span>
                {fmtDate(tank.nextInspectionDate)}
                {days !== null && (
                  <span className={`ti-panel__days ${days < 0 ? 'ti-panel__days--over' : days <= 30 ? 'ti-panel__days--soon' : ''}`}>
                    {days < 0 ? ` (${Math.abs(days)}d overdue)` : ` (${days}d)`}
                  </span>
                )}
              </span>
            </div>
          </section>

          {/* Level visual */}
          <section className="ti-panel__section">
            <div className="ti-panel__section-title">Current Level</div>
            <div className="ti-level-visual">
              <div className="ti-level-visual__cylinder">
                <div
                  className="ti-level-visual__fill"
                  style={{ height: `${tank.currentLevelPct ?? 0}%` }}
                />
              </div>
              <div className="ti-level-visual__label">
                {tank.currentLevelPct !== undefined
                  ? `${tank.currentLevelPct}%`
                  : 'Not recorded'}
              </div>
            </div>
            <p className="ti-panel__hint">Level history tracking requires telemetry integration (Phase 2).</p>
          </section>

          {/* Inspection documents */}
          <section className="ti-panel__section">
            <div className="ti-panel__section-title">Inspection Documents</div>
            {docs.length === 0 && (
              <p className="ti-panel__hint">No documents uploaded yet.</p>
            )}
            {docs.map((f) => (
              <div key={f.id} className="ti-doc-row">
                <svg className="ti-doc-row__icon" width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
                  <path d="M14 2v6h6" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
                </svg>
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ti-doc-row__name"
                >
                  {f.fileName}
                </a>
                <span className="ti-doc-row__date">{fmtDate(f.createdAt)}</span>
              </div>
            ))}

            {/* Upload */}
            {uploadError && <div className="ti-upload-error">{uploadError}</div>}
            {uploading && (
              <div className="ti-upload-progress">
                <div className="ti-upload-progress__bar" style={{ width: `${uploadPct}%` }} />
                <span>{uploadPct}%</span>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.heic"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleUpload(f)
                e.target.value = ''
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? `Uploading ${uploadPct}%…` : '+ Upload Document'}
            </Button>
          </section>

          {/* Event timeline */}
          <section className="ti-panel__section">
            <div className="ti-panel__section-title">Activity Timeline</div>
            <TankTimeline tankId={tank.id} />
          </section>
        </div>

        {/* Footer */}
        <div className="ti-panel__footer">
          <Button variant="ghost" size="sm" onClick={() => setShowQR(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '6px' }}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h7v7h-7z"/></svg>
            QR Code
          </Button>
          <Button variant="secondary" size="sm" onClick={onEdit}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '6px' }}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            Edit
          </Button>
          {tank.status === 'deployed' && (
            <Button variant="secondary" size="sm" onClick={onRefill}>
              Create Refill Order
            </Button>
          )}
        </div>
      </div>
    </div>
    {showQR && <TankQRModal tank={tank} onClose={() => setShowQR(false)} />}
    </>
  )
}

// ── Add cylinder modal ─────────────────────────────────────────────────────────

interface AddCylinderModalProps {
  onClose: () => void
  onCreated: () => void
}

function AddCylinderModal({ onClose, onCreated }: AddCylinderModalProps) {
  const [productId,     setProductId]     = useState('')
  const [serial,        setSerial]        = useState('')
  const [gasType,       setGasType]       = useState('')
  const [sizeLabel,     setSizeLabel]     = useState('')
  const [capacityValue, setCapacityValue] = useState('')
  const [capacityUnit,  setCapacityUnit]  = useState('gal')
  const [monthlyRate,   setMonthlyRate]   = useState('')
  const [ownership,     setOwnership]     = useState<'company' | 'customer'>('company')
  const [notes,         setNotes]         = useState('')
  const [busy,          setBusy]          = useState(false)
  const [error,         setError]         = useState('')

  // Gas type presets
  const GAS_TYPES = ['CO2', 'Nitrogen', 'Propane', 'Oxygen', 'Argon', 'Helium']
  const CAPACITY_UNITS = ['gal', 'lb', 'cf', 'L']

  function handleProductSelect(item: ProductDropdownItem | null) {
    setProductId(item?.id ?? '')
    if (item) {
      // Auto-fill gas type from product name
      const name = item.name.toLowerCase()
      if (name.includes('carbon dioxide') || name.includes('co2')) setGasType('CO2')
      else if (name.includes('nitrogen')) setGasType('Nitrogen')
      else if (name.includes('argon')) setGasType('Argon')
      else setGasType(item.category)
      // Auto-fill size label
      if (item.sku) setSizeLabel(item.sku)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!serial.trim()) return setError('Serial number is required.')
    if (!gasType.trim()) return setError('Gas type is required.')
    if (!sizeLabel.trim()) return setError('Size label is required.')
    if (!capacityValue || isNaN(Number(capacityValue))) return setError('Capacity must be a number.')

    setBusy(true)
    setError('')
    try {
      await createTank({
        // Use 'WAREHOUSE' as the placeholder customerId for unassigned inventory.
        // This is updated when the cylinder is deployed to a customer.
        customerId: 'WAREHOUSE',
        serialNumber: serial.trim(),
        gasType: gasType.trim(),
        sizeLabel: sizeLabel.trim(),
        capacityValue: Number(capacityValue),
        capacityUnit,
        ownership,
        monthlyRate: monthlyRate ? Number(monthlyRate) : undefined,
        notes: notes || undefined,
        ...(productId ? { productId } : {}),
      } as Parameters<typeof createTank>[0])
      onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create cylinder.')
      setBusy(false)
    }
  }

  return (
    <div className="ti-overlay" onClick={onClose}>
      <div className="ti-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Add cylinder">
        <div className="ti-modal__header">
          <h2 className="ti-modal__title">Add Cylinder</h2>
          <button className="ti-modal__close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <form className="ti-modal__body" onSubmit={handleSubmit} noValidate>
          {error && <div className="ti-form-error">{error}</div>}

          <ProductCombobox
            label="Catalog Product (optional)"
            value={productId}
            onSelect={handleProductSelect}
            placeholder="Link to a catalog product…"
          />

          <div className="ti-form-grid">
            <Input label="Serial Number *" value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="e.g. CO2-0042" required />

            <div className="ti-field">
              <label className="ti-field__label" htmlFor="add-gastype">Gas Type *</label>
              <div className="ti-combo">
                <select
                  id="add-gastype"
                  className="ti-select"
                  value={GAS_TYPES.includes(gasType) ? gasType : '__custom'}
                  onChange={(e) => {
                    if (e.target.value !== '__custom') setGasType(e.target.value)
                  }}
                >
                  {GAS_TYPES.map((g) => <option key={g} value={g}>{g}</option>)}
                  <option value="__custom">Custom…</option>
                </select>
                {!GAS_TYPES.includes(gasType) && (
                  <input
                    className="ti-combo__custom"
                    placeholder="Enter gas type…"
                    value={gasType}
                    onChange={(e) => setGasType(e.target.value)}
                    autoFocus
                  />
                )}
              </div>
            </div>

            <Input label="Size Label *" value={sizeLabel} onChange={(e) => setSizeLabel(e.target.value)} placeholder="e.g. 50 lb, 100 cf" required />

            <div className="ti-field">
              <label className="ti-field__label">Capacity *</label>
              <div className="ti-capacity-row">
                <input
                  className="ti-input"
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={capacityValue}
                  onChange={(e) => setCapacityValue(e.target.value)}
                  placeholder="e.g. 50"
                  required
                />
                <select className="ti-select ti-select--unit" value={capacityUnit} onChange={(e) => setCapacityUnit(e.target.value)}>
                  {CAPACITY_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>

            <div className="ti-field">
              <label className="ti-field__label" htmlFor="add-ownership">Ownership</label>
              <select
                id="add-ownership"
                className="ti-select"
                value={ownership}
                onChange={(e) => setOwnership(e.target.value as 'company' | 'customer')}
              >
                <option value="company">Company-owned</option>
                <option value="customer">Customer-owned</option>
              </select>
            </div>

            <Input
              label="Monthly Rental Rate ($)"
              type="number"
              min={0}
              step={5}
              value={monthlyRate}
              onChange={(e) => setMonthlyRate(e.target.value)}
              placeholder="0"
            />
          </div>

          <div className="ti-field ti-field--full">
            <label className="ti-field__label" htmlFor="add-notes">Notes</label>
            <textarea
              id="add-notes"
              className="ti-textarea"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional notes…"
            />
          </div>

          <div className="ti-modal__footer">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add Cylinder'}</Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Tank QR code modal ─────────────────────────────────────────────────────────

function TankQRModal({ tank, onClose }: { tank: Tank; onClose: () => void }) {
  const qrValue = `https://ogs-portal.web.app/driver/truck?scan=${tank.id}`
  return (
    <div className="ti-overlay" onClick={onClose}>
      <div className="ti-modal ti-modal--qr" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Tank QR code">
        <div className="ti-modal__header">
          <h2 className="ti-modal__title">QR Code — {tank.serialNumber}</h2>
          <button className="ti-modal__close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="ti-qr-body">
          <QRCodeSVG value={qrValue} size={220} includeMargin />
          <p className="ti-qr-serial">{tank.gasType} · {tank.sizeLabel}</p>
          <p className="ti-qr-hint">Scan with driver app to load / return this tank</p>
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '6px' }}><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Print
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Tank event timeline ────────────────────────────────────────────────────────

const EVENT_LABELS: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  created: {
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/></svg>,
    label: 'Added to inventory',
    color: '#6b7280',
  },
  loaded_to_truck: {
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 17H5l-1-1V9c0-1 .9-2 2-2h12c1.1 0 2 .9 2 2v7l-1 1h-4"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>,
    label: 'Loaded to truck',
    color: '#3b82f6',
  },
  unloaded_from_truck: {
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 7L3 5m0 0v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5"/><path d="M8 9v6M12 9v6M16 9v6"/></svg>,
    label: 'Unloaded from truck',
    color: '#6b7280',
  },
  delivered_to_customer: {
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>,
    label: 'Delivered to customer',
    color: '#22c55e',
  },
  empty_returned: {
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7M12 19l7-7"/></svg>,
    label: 'Empty returned',
    color: '#f59e0b',
  },
  status_changed: {
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>,
    label: 'Status changed',
    color: '#8b5cf6',
  },
  inspection_updated: {
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>,
    label: 'Inspection updated',
    color: '#0ea5e9',
  },
}

function TankTimeline({ tankId }: { tankId: string }) {
  const [events, setEvents] = useState<TankEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const unsub = subscribeToTankEvents(tankId, (evts) => {
      setEvents(evts)
      setLoading(false)
    })
    return unsub
  }, [tankId])

  if (loading) return <p className="ti-panel__hint">Loading timeline…</p>
  if (events.length === 0) return <p className="ti-panel__hint">No events recorded yet.</p>

  return (
    <div className="ti-timeline">
      {events.map((evt, i) => {
        const cfg = EVENT_LABELS[evt.type] ?? { icon: <span style={{ color: '#6b7280' }}>•</span>, label: evt.type, color: '#6b7280' }
        const ts = evt.timestamp?.toDate ? evt.timestamp.toDate() : null
        return (
          <div key={evt.id} className={`ti-timeline__item${i === 0 ? ' ti-timeline__item--first' : ''}`}>
            <div className="ti-timeline__dot" style={{ background: cfg.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{cfg.icon}</div>
            <div className="ti-timeline__content">
              <div className="ti-timeline__label">{cfg.label}</div>
              {evt.actorName && <div className="ti-timeline__actor">{evt.actorName}</div>}
              {evt.customerName && <div className="ti-timeline__detail">Customer: {evt.customerName}</div>}
              {evt.signedBy && <div className="ti-timeline__detail">Signed by: {evt.signedBy}</div>}
              {evt.note && <div className="ti-timeline__detail">{evt.note}</div>}
              {ts && <div className="ti-timeline__time">{ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Edit cylinder modal ────────────────────────────────────────────────────────

interface EditCylinderModalProps {
  tank: Tank
  onClose: () => void
  onSaved: () => void
}

function EditCylinderModal({ tank, onClose, onSaved }: EditCylinderModalProps) {
  function tsToDateStr(ts: unknown): string {
    if (!ts || typeof (ts as { toDate?: unknown }).toDate !== 'function') return ''
    return (ts as { toDate: () => Date }).toDate().toISOString().slice(0, 10)
  }

  const GAS_TYPES = ['CO2', 'Nitrogen', 'Propane', 'Oxygen', 'Argon', 'Helium']
  const CAPACITY_UNITS = ['gal', 'lb', 'cf', 'L']

  const [serial,         setSerial]         = useState(tank.serialNumber)
  const [gasType,        setGasType]        = useState(tank.gasType)
  const [sizeLabel,      setSizeLabel]      = useState(tank.sizeLabel)
  const [capacityValue,  setCapacityValue]  = useState(String(tank.capacityValue))
  const [capacityUnit,   setCapacityUnit]   = useState(tank.capacityUnit)
  const [ownership,      setOwnership]      = useState<'company' | 'customer'>(tank.ownership ?? 'company')
  const [monthlyRate,    setMonthlyRate]    = useState(String(tank.monthlyRate ?? ''))
  const [currentLevel,   setCurrentLevel]   = useState(String(tank.currentLevelPct ?? ''))
  const [lastInspection, setLastInspection] = useState(tsToDateStr(tank.lastInspectionDate))
  const [nextInspection, setNextInspection] = useState(tsToDateStr(tank.nextInspectionDate))
  const [notes,          setNotes]          = useState(tank.notes ?? '')
  const [busy,           setBusy]           = useState(false)
  const [error,          setError]          = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!serial.trim()) return setError('Serial number is required.')
    if (!gasType.trim()) return setError('Gas type is required.')
    if (!sizeLabel.trim()) return setError('Size label is required.')
    if (!capacityValue || isNaN(Number(capacityValue))) return setError('Capacity must be a number.')
    setBusy(true)
    setError('')
    try {
      const updates: Partial<Omit<Tank, 'id'>> = {
        serialNumber:   serial.trim(),
        gasType:        gasType.trim(),
        sizeLabel:      sizeLabel.trim(),
        capacityValue:  Number(capacityValue),
        capacityUnit,
        ownership,
        monthlyRate:    monthlyRate !== '' ? Number(monthlyRate) : undefined,
        currentLevelPct: currentLevel !== '' ? Number(currentLevel) : undefined,
        notes:          notes.trim() || undefined,
      }
      if (lastInspection) updates.lastInspectionDate = new Date(lastInspection + 'T12:00:00') as unknown as Tank['lastInspectionDate']
      if (nextInspection) updates.nextInspectionDate = new Date(nextInspection + 'T12:00:00') as unknown as Tank['nextInspectionDate']
      await updateTank(tank.id, updates)
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update cylinder.')
      setBusy(false)
    }
  }

  return (
    <div className="ti-overlay" onClick={onClose}>
      <div className="ti-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Edit cylinder">
        <div className="ti-modal__header">
          <h2 className="ti-modal__title">Edit — {tank.serialNumber}</h2>
          <button className="ti-modal__close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <form className="ti-modal__body" onSubmit={handleSubmit} noValidate>
          {error && <div className="ti-form-error">{error}</div>}

          <div className="ti-form-grid">
            <Input label="Serial Number *" value={serial} onChange={(e) => setSerial(e.target.value)} required />

            <div className="ti-field">
              <label className="ti-field__label" htmlFor="edit-gastype">Gas Type *</label>
              <div className="ti-combo">
                <select
                  id="edit-gastype"
                  className="ti-select"
                  value={GAS_TYPES.includes(gasType) ? gasType : '__custom'}
                  onChange={(e) => { if (e.target.value !== '__custom') setGasType(e.target.value) }}
                >
                  {GAS_TYPES.map((g) => <option key={g} value={g}>{g}</option>)}
                  <option value="__custom">Custom…</option>
                </select>
                {!GAS_TYPES.includes(gasType) && (
                  <input className="ti-combo__custom" placeholder="Enter gas type…" value={gasType} onChange={(e) => setGasType(e.target.value)} />
                )}
              </div>
            </div>

            <Input label="Size Label *" value={sizeLabel} onChange={(e) => setSizeLabel(e.target.value)} required />

            <div className="ti-field">
              <label className="ti-field__label">Capacity *</label>
              <div className="ti-capacity-row">
                <input className="ti-input" type="number" min={0.1} step={0.1} value={capacityValue} onChange={(e) => setCapacityValue(e.target.value)} required />
                <select className="ti-select ti-select--unit" value={capacityUnit} onChange={(e) => setCapacityUnit(e.target.value)}>
                  {CAPACITY_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>

            <div className="ti-field">
              <label className="ti-field__label" htmlFor="edit-ownership">Ownership</label>
              <select id="edit-ownership" className="ti-select" value={ownership} onChange={(e) => setOwnership(e.target.value as 'company' | 'customer')}>
                <option value="company">Company-owned</option>
                <option value="customer">Customer-owned</option>
              </select>
            </div>

            <Input label="Monthly Rental Rate ($)" type="number" min={0} step={5} value={monthlyRate} onChange={(e) => setMonthlyRate(e.target.value)} placeholder="0" />
            <Input label="Current Level (%)" type="number" min={0} max={100} step={1} value={currentLevel} onChange={(e) => setCurrentLevel(e.target.value)} placeholder="—" />
            <Input label="Last Inspection Date" type="date" value={lastInspection} onChange={(e) => setLastInspection(e.target.value)} />
            <Input label="Next Inspection Due" type="date" value={nextInspection} onChange={(e) => setNextInspection(e.target.value)} />
          </div>

          <div className="ti-field ti-field--full">
            <label className="ti-field__label" htmlFor="edit-notes">Notes</label>
            <textarea id="edit-notes" className="ti-textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any additional notes…" />
          </div>

          <div className="ti-modal__footer">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save Changes'}</Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Create refill order modal ──────────────────────────────────────────────────

interface CreateRefillModalProps {
  tank: Tank
  customer?: Customer
  onClose: () => void
  onCreated: () => void
}

function CreateRefillModal({ tank, customer, onClose, onCreated }: CreateRefillModalProps) {
  const [products, setProducts] = useState<Product[]>([])
  const [productId, setProductId] = useState('')
  const [quantity, setQuantity] = useState(tank.capacityValue)
  const [tier, setTier] = useState<DeliveryTier>('standard')
  const [notes, setNotes] = useState(`Refill for cylinder ${tank.serialNumber}`)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getDocs(query(productsCol, where('active', '==', true), orderBy('name')))
      .then((snap) => setProducts(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Product)))
      .catch(() => {})
  }, [])

  const selectedProduct = products.find((p) => p.id === productId)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!productId) return setError('Select a product.')
    if (!tank.customerId || tank.customerId === 'WAREHOUSE') return setError('Tank must be assigned to a customer.')
    if (quantity <= 0) return setError('Quantity must be > 0.')
    setBusy(true)
    setError('')
    try {
      await createOrder(
        {
          customerId: tank.customerId,
          productId,
          tankId: tank.id,
          quantity,
          deliveryTier: tier,
          notes,
        },
        selectedProduct?.pricePerUnit ?? 0,
      )
      onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create order.')
      setBusy(false)
    }
  }

  return (
    <div className="ti-overlay" onClick={onClose}>
      <div className="ti-modal ti-modal--sm" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Create refill order">
        <div className="ti-modal__header">
          <h2 className="ti-modal__title">Create Refill Order</h2>
          <button className="ti-modal__close" onClick={onClose}>✕</button>
        </div>
        <form className="ti-modal__body" onSubmit={handleSubmit} noValidate>
          {error && <div className="ti-form-error">{error}</div>}

          <div className="ti-panel__row ti-panel__row--info">
            <span className="ti-panel__lbl">Cylinder</span>
            <span>{tank.serialNumber} · {tank.gasType} {tank.sizeLabel}</span>
          </div>
          <div className="ti-panel__row ti-panel__row--info">
            <span className="ti-panel__lbl">Customer</span>
            <span>{customer?.name ?? tank.customerId}</span>
          </div>

          <div className="ti-field">
            <label className="ti-field__label" htmlFor="refill-product">Product *</label>
            <select id="refill-product" className="ti-select" value={productId} onChange={(e) => setProductId(e.target.value)} required>
              <option value="">Select product…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="ti-field">
            <label className="ti-field__label" htmlFor="refill-qty">
              Quantity ({selectedProduct?.unit ?? tank.capacityUnit ?? 'units'}) *
            </label>
            <input
              id="refill-qty"
              className="ti-input"
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              required
            />
          </div>

          <div className="ti-field">
            <label className="ti-field__label" htmlFor="refill-tier">Delivery Tier</label>
            <select id="refill-tier" className="ti-select" value={tier} onChange={(e) => setTier(e.target.value as DeliveryTier)}>
              <option value="standard">Standard</option>
              <option value="next-day">Next Day (+10%)</option>
              <option value="same-day">Same Day (+25%)</option>
            </select>
          </div>

          <div className="ti-field">
            <label className="ti-field__label" htmlFor="refill-notes">Notes</label>
            <textarea id="refill-notes" className="ti-textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="ti-modal__footer">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create Order'}</Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function TankInventory() {
  const navigate = useNavigate()
  const [allTanks, setAllTanks] = useState<Tank[]>([])
  const [customerMap, setCustomerMap] = useState<Record<string, Customer>>({})
  const [loading, setLoading] = useState(true)
  const loadedCustomerIds = useRef<Set<string>>(new Set())

  // ── Filters ───────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<TabKey>('all')
  const [search, setSearch] = useState('')

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [detailTank,   setDetailTank]   = useState<Tank | null>(null)
  const [showAdd,      setShowAdd]      = useState(false)
  const [editTank,     setEditTank]     = useState<Tank | null>(null)
  const [refillTank,   setRefillTank]   = useState<Tank | null>(null)
  const [importing,    setImporting]    = useState(false)
  const [importError,  setImportError]  = useState('')
  const [importResult, setImportResult] = useState<{ created: number; updated: number; errors: number } | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  // Subscribe to all tanks
  useEffect(() => {
    const unsub = onSnapshot(
      query(tanksCol, orderBy('serialNumber')),
      (snap) => {
        setAllTanks(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Tank))
        setLoading(false)
      },
    )
    return unsub
  }, [])

  // Batch-load customer names
  useEffect(() => {
    const ids = [
      ...new Set(
        allTanks.map((t) => t.customerId).filter((id) => id && id !== 'WAREHOUSE'),
      ),
    ].filter((id) => !loadedCustomerIds.current.has(id))
    if (!ids.length) return
    ids.forEach((id) => loadedCustomerIds.current.add(id))
    Promise.all(
      ids.map((id) =>
        getDoc(doc(db, 'customers', id)).then((s) =>
          s.exists() ? ({ id: s.id, ...s.data() } as Customer) : null,
        ),
      ),
    ).then((docs) => {
      const map: Record<string, Customer> = {}
      docs.forEach((c) => { if (c) map[c.id] = c })
      setCustomerMap((prev) => ({ ...prev, ...map }))
    })
  }, [allTanks])

  // ── Derived data ──────────────────────────────────────────────────────────────

  const stockGroups = useMemo<StockGroup[]>(() => {
    const map = new Map<string, StockGroup>()
    allTanks.forEach((t) => {
      const key = `${t.gasType}||${t.sizeLabel}`
      const existing = map.get(key) ?? {
        key,
        gasType: t.gasType,
        sizeLabel: t.sizeLabel,
        available: 0,
        on_truck: 0,
        deployed: 0,
        inspection: 0,
        returned: 0,
      }
      ;(existing as unknown as Record<string, number>)[t.status] = ((existing as unknown as Record<string, number>)[t.status] ?? 0) + 1
      map.set(key, existing)
    })
    return [...map.values()].sort((a, b) =>
      a.gasType.localeCompare(b.gasType) || a.sizeLabel.localeCompare(b.sizeLabel),
    )
  }, [allTanks])

  const lowAlerts = useMemo(
    () =>
      allTanks.filter(
        (t) =>
          t.status === 'deployed' &&
          t.currentLevelPct !== undefined &&
          t.currentLevelPct < LOW_LEVEL_THRESHOLD,
      ),
    [allTanks],
  )

  const tabCounts = useMemo(
    () => ({
      all:        allTanks.length,
      available:  allTanks.filter((t) => t.status === 'available').length,
      on_truck:   allTanks.filter((t) => t.status === 'on_truck').length,
      deployed:   allTanks.filter((t) => t.status === 'deployed').length,
      returned:   allTanks.filter((t) => t.status === 'returned').length,
      inspection: allTanks.filter((t) => t.status === 'inspection').length,
    } as Record<TabKey, number>),
    [allTanks],
  )

  const filtered = useMemo(() => {
    let result = tab === 'all' ? allTanks : allTanks.filter((t) => t.status === tab)
    if (search.trim()) {
      const lc = search.toLowerCase()
      result = result.filter(
        (t) =>
          t.serialNumber.toLowerCase().includes(lc) ||
          t.gasType.toLowerCase().includes(lc) ||
          customerMap[t.customerId]?.name.toLowerCase().includes(lc),
      )
    }
    return result
  }, [allTanks, tab, search, customerMap])

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'all',        label: 'All' },
    { key: 'available',  label: 'Available' },
    { key: 'deployed',   label: 'Deployed' },
    { key: 'returned',   label: 'Returned' },
    { key: 'inspection', label: 'Inspection' },
  ]

  // ── Export ────────────────────────────────────────────────────────────────────

  function handleExport() {
    const rows = allTanks.map((t) => ({
      'Serial #':       t.serialNumber,
      'Gas Type':       t.gasType,
      'Size':           t.sizeLabel,
      'Capacity Value': t.capacityValue,
      'Capacity Unit':  t.capacityUnit,
      'Status':         t.status,
      'Customer':       customerMap[t.customerId]?.name ?? '',
      'Level %':        t.currentLevelPct ?? '',
      'Last Inspection':t.lastInspectionDate ? fmtDate(t.lastInspectionDate) : '',
      'Next Due':       t.nextInspectionDate ? fmtDate(t.nextInspectionDate) : '',
      'Ownership':      t.ownership ?? 'company',
      'Monthly Rate':   t.monthlyRate ?? '',
      'Notes':          t.notes ?? '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Tank Inventory')
    XLSX.writeFile(wb, 'tank-inventory.xlsx')
  }

  // ── Import ────────────────────────────────────────────────────────────────────

  async function handleImport(file: File) {
    setImporting(true)
    setImportError('')
    setImportResult(null)
    try {
      const buf = await file.arrayBuffer()
      const wb  = XLSX.read(buf, { type: 'array', cellDates: true })
      const ws  = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)

      let created = 0, updated = 0, errors = 0

      for (const row of rows) {
        const serial = String(row['Serial #'] ?? '').trim()
        if (!serial) continue

        const gasType      = String(row['Gas Type']      ?? '').trim()
        const sizeLabel    = String(row['Size']          ?? '').trim()
        const capValue     = Number(row['Capacity Value'] ?? 0)
        const capUnit      = String(row['Capacity Unit'] ?? 'gal').trim()
        const ownership    = (String(row['Ownership']   ?? 'company').trim()) as 'company' | 'customer'
        const levelPct     = row['Level %'] !== '' && row['Level %'] !== undefined ? Number(row['Level %']) : undefined
        const monthlyRate  = row['Monthly Rate'] !== '' && row['Monthly Rate'] !== undefined ? Number(row['Monthly Rate']) : undefined
        const notes        = String(row['Notes'] ?? '').trim() || undefined

        function parseDate(v: unknown): Date | undefined {
          if (!v) return undefined
          if (v instanceof Date) return v
          const d = new Date(String(v))
          return isNaN(d.getTime()) ? undefined : d
        }

        const lastInsp = parseDate(row['Last Inspection'])
        const nextInsp = parseDate(row['Next Due'])

        const existing = allTanks.find((t) => t.serialNumber === serial)
        try {
          if (existing) {
            const updates: Partial<Omit<Tank, 'id'>> = {
              ...(gasType   ? { gasType }    : {}),
              ...(sizeLabel ? { sizeLabel }  : {}),
              ...(capValue  ? { capacityValue: capValue } : {}),
              ...(capUnit   ? { capacityUnit: capUnit }   : {}),
              ownership,
              ...(monthlyRate !== undefined ? { monthlyRate } : {}),
              ...(levelPct   !== undefined ? { currentLevelPct: levelPct } : {}),
              ...(notes !== undefined      ? { notes }          : {}),
              ...(lastInsp ? { lastInspectionDate: lastInsp as unknown as Tank['lastInspectionDate'] } : {}),
              ...(nextInsp ? { nextInspectionDate: nextInsp as unknown as Tank['nextInspectionDate'] } : {}),
            }
            await updateTank(existing.id, updates)
            updated++
          } else {
            if (!gasType || !sizeLabel || !capValue) { errors++; continue }
            await createTank({
              customerId: 'WAREHOUSE',
              serialNumber: serial,
              gasType,
              sizeLabel,
              capacityValue: capValue,
              capacityUnit: capUnit,
              ownership,
              monthlyRate,
              currentLevelPct: levelPct,
              notes,
            } as Parameters<typeof createTank>[0])
            created++
          }
        } catch {
          errors++
        }
      }

      setImportResult({ created, updated, errors })
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to parse file.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="ti-page">
      {/* ── Page header ── */}
      <div className="ti-page-header">
        <div className="ti-page-header__left">
          <h1 className="ti-page-header__title">Tank Inventory</h1>
          {!loading && (
            <span className="ti-page-header__count">{allTanks.length} cylinders</span>
          )}
        </div>
        <div className="ti-page-header__actions">
          <Button variant="ghost" size="sm" onClick={handleExport} disabled={loading || allTanks.length === 0}>
            ↓ Export Excel
          </Button>
          <Button variant="ghost" size="sm" onClick={() => importInputRef.current?.click()} disabled={importing}>
            {importing ? 'Importing…' : '↑ Import Excel'}
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleImport(f)
              e.target.value = ''
            }}
          />
          <Button size="sm" onClick={() => setShowAdd(true)}>+ Add Cylinder</Button>
        </div>
      </div>

      {/* ── Import feedback ── */}
      {importError && (
        <div className="ti-import-msg ti-import-msg--error">{importError}</div>
      )}
      {importResult && (
        <div className="ti-import-msg ti-import-msg--success">
          Import complete — {importResult.created} created, {importResult.updated} updated
          {importResult.errors > 0 ? `, ${importResult.errors} skipped` : ''}.
          <button className="ti-import-msg__dismiss" onClick={() => setImportResult(null)}>✕</button>
        </div>
      )}

      {/* ── Stock summary cards ── */}
      {stockGroups.length > 0 && (
        <div className="ti-stock-grid">
          {stockGroups.map((g) => (
            <StockCard key={g.key} group={g} />
          ))}
        </div>
      )}

      {/* ── Low level alerts ── */}
      {lowAlerts.length > 0 && (
        <div className="ti-alert-section">
          <div className="ti-alert-section__header">
            <span className="ti-alert-section__dot" />
            Low Level Alerts — {lowAlerts.length} cylinder{lowAlerts.length > 1 ? 's' : ''} below {LOW_LEVEL_THRESHOLD}%
          </div>
          <div className="ti-alert-list">
            {lowAlerts.map((t) => (
              <LowAlertRow
                key={t.id}
                tank={t}
                customer={customerMap[t.customerId]}
                onRefill={(tank) => setRefillTank(tank)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Tabs + search + table ── */}
      <div className="ti-table-card">
        <div className="ti-table-toolbar">
          {/* Tabs */}
          <div className="ti-tabs">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                className={`ti-tab ${tab === key ? 'ti-tab--active' : ''}`}
                onClick={() => setTab(key)}
              >
                {label}
                <span className="ti-tab__count">{tabCounts[key]}</span>
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="ti-search">
            <svg className="ti-search__icon" width="13" height="13" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" />
              <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              className="ti-search__input"
              placeholder="Search serial, gas type, customer…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="ti-search__clear" onClick={() => setSearch('')} aria-label="Clear">✕</button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="ti-empty">Loading cylinders…</div>
        ) : filtered.length === 0 ? (
          <div className="ti-empty">No cylinders match the current filter.</div>
        ) : (
          <div className="ti-table-wrap">
            <table className="ti-table">
              <thead>
                <tr>
                  <th className="ti-table__th">Serial #</th>
                  <th className="ti-table__th">Gas Type</th>
                  <th className="ti-table__th">Size</th>
                  <th className="ti-table__th">Status</th>
                  <th className="ti-table__th">Customer</th>
                  <th className="ti-table__th">Level</th>
                  <th className="ti-table__th ti-table__th--date">Last Inspection</th>
                  <th className="ti-table__th">Next Due</th>
                  <th className="ti-table__th ti-table__th--actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((tank) => (
                  <CylinderRow
                    key={tank.id}
                    tank={tank}
                    customer={customerMap[tank.customerId]}
                    onViewDetail={() => setDetailTank(tank)}
                    onRefill={() => setRefillTank(tank)}
                    onEdit={() => setEditTank(tank)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Cylinder detail panel ── */}
      {detailTank && (
        <CylinderDetailPanel
          tank={detailTank}
          customer={customerMap[detailTank.customerId]}
          onClose={() => setDetailTank(null)}
          onRefill={() => { setRefillTank(detailTank); setDetailTank(null) }}
          onEdit={() => { setEditTank(detailTank); setDetailTank(null) }}
        />
      )}

      {/* ── Add cylinder modal ── */}
      {showAdd && (
        <AddCylinderModal
          onClose={() => setShowAdd(false)}
          onCreated={() => {}}
        />
      )}

      {/* ── Edit cylinder modal ── */}
      {editTank && (
        <EditCylinderModal
          tank={editTank}
          onClose={() => setEditTank(null)}
          onSaved={() => {}}
        />
      )}

      {/* ── Create refill order modal ── */}
      {refillTank && (
        <CreateRefillModal
          tank={refillTank}
          customer={customerMap[refillTank.customerId]}
          onClose={() => setRefillTank(null)}
          onCreated={() => navigate('/ops/orders')}
        />
      )}
    </div>
  )
}
