/**
 * src/pages/driver/TruckLoadPage.tsx
 * BEM prefix: tl-
 *
 * Pre-departure truck load checklist. Driver scans every cylinder's QR code
 * before they are allowed to start the run. Tablet-optimised for warehouse
 * and loading dock use — min 48px touch targets, min 16px fonts, high contrast.
 *
 * Route: /driver/load/:runId
 * Roles: driver, dispatch, admin
 */

import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useAuth } from '../../hooks/useAuth'
import { useTruckLoad } from '../../hooks/useTruckLoad'
import { QRScanner } from '../../components/driver/QRScanner'
import { Badge } from '../../components/ui/Badge'
import type { Run } from '../../types/run'
import type { ManifestItem } from '../../types/cylinder'
import type { ScanResult } from '../../hooks/useTruckLoad'
import './TruckLoadPage.css'

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(ts?: { toDate(): Date } | null): string {
  if (!ts) return new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
  return ts.toDate().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}

// Group manifest items by stop sequence, preserving order
function groupByStop(items: ManifestItem[]): Map<number, ManifestItem[]> {
  const map = new Map<number, ManifestItem[]>()
  const sorted = [...items].sort((a, b) => a.stopSequence - b.stopSequence)
  for (const item of sorted) {
    const group = map.get(item.stopSequence) ?? []
    group.push(item)
    map.set(item.stopSequence, group)
  }
  return map
}

// ── Scan feedback row ──────────────────────────────────────────────────────────

interface ScanFeedbackProps {
  result: ScanResult
  onDismiss: () => void
}

function ScanFeedback({ result, onDismiss }: ScanFeedbackProps) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    setVisible(true)
    const fadeTimer = setTimeout(() => setVisible(false), 2700)
    const removeTimer = setTimeout(() => onDismiss(), 3000)
    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(removeTimer)
    }
  }, [result, onDismiss])

  let modifier = ''
  let icon = ''
  if (result.status === 'success')       { modifier = 'tl-feedback--success'; icon = '✓' }
  if (result.status === 'notInManifest') { modifier = 'tl-feedback--warn';    icon = '⚠' }
  if (result.status === 'duplicate')     { modifier = 'tl-feedback--info';    icon = 'ℹ' }
  if (result.status === 'error')         { modifier = 'tl-feedback--error';   icon = '✕' }

  return (
    <div className={`tl-feedback ${modifier} ${visible ? '' : 'tl-feedback--fading'}`.trim()}>
      <span className="tl-feedback__icon" aria-hidden="true">{icon}</span>
      <span className="tl-feedback__msg">{result.message}</span>
    </div>
  )
}

// ── Manifest cylinder row ──────────────────────────────────────────────────────

interface CylinderRowProps {
  item: ManifestItem
  scanned: boolean
  canOverride: boolean
  onOverride: (item: ManifestItem) => void
  onScanClick: () => void
}

function CylinderRow({ item, scanned, canOverride, onOverride, onScanClick }: CylinderRowProps) {
  return (
    <div className={`tl-cylinder-row ${scanned ? 'tl-cylinder-row--scanned' : ''}`.trim()}>
      <span className="tl-cylinder-row__check" aria-hidden="true">
        {scanned ? '✓' : '○'}
      </span>
      <span className="tl-cylinder-row__name">
        {item.productName} <span className="tl-cylinder-row__size">{item.sizeLabel}</span>
      </span>
      {!scanned && (
        <button
          className="tl-cylinder-row__scan-btn"
          onClick={onScanClick}
          aria-label={`Scan QR code for ${item.productName} ${item.sizeLabel}`}
        >
          📷 Scan
        </button>
      )}
      {canOverride && !scanned && (
        <button
          className="tl-btn tl-btn--warn-sm"
          onClick={() => onOverride(item)}
          aria-label={`Manual override for ${item.cylinderId}`}
          title="Override (no scan)"
        >
          Override
        </button>
      )}
    </div>
  )
}

// ── Stop group ─────────────────────────────────────────────────────────────────

interface StopGroupProps {
  stopSequence: number
  customerName: string
  items: ManifestItem[]
  scannedIds: Set<string>
  canOverride: boolean
  onOverride: (item: ManifestItem) => void
  onScanClick: (cylinderId: string) => void
}

function StopGroup({ stopSequence, customerName, items, scannedIds, canOverride, onOverride, onScanClick }: StopGroupProps) {
  const scannedCount = items.filter((i) => scannedIds.has(i.cylinderId)).length
  const total = items.length
  const allDone = scannedCount === total

  return (
    <div className={`tl-stop-group ${allDone ? 'tl-stop-group--complete' : ''}`.trim()}>
      <div className="tl-stop-group__header">
        <span className="tl-stop-group__label">
          Stop #{stopSequence} — {customerName}
        </span>
        <Badge variant={allDone ? 'success' : 'neutral'}>
          {scannedCount} of {total}
        </Badge>
      </div>
      <div className="tl-stop-group__rows">
        {items.map((item) => (
          <CylinderRow
            key={item.cylinderId}
            item={item}
            scanned={scannedIds.has(item.cylinderId)}
            canOverride={canOverride}
            onOverride={onOverride}
            onScanClick={() => onScanClick(item.cylinderId)}
          />
        ))}
      </div>
    </div>
  )
}

// ── Override confirmation modal ────────────────────────────────────────────────

interface OverrideModalProps {
  item: ManifestItem
  onConfirm: (reason: string) => void
  onCancel: () => void
}

function OverrideModal({ item, onConfirm, onCancel }: OverrideModalProps) {
  const [reason, setReason] = useState('')

  return (
    <div className="tl-modal-backdrop" role="dialog" aria-modal="true" aria-label="Manual override">
      <div className="tl-modal">
        <h2 className="tl-modal__title">Manual Override</h2>
        <p className="tl-modal__body">
          Mark <strong>{item.productName} {item.sizeLabel}</strong> ({item.cylinderId}) as loaded
          without scanning?
        </p>
        <label className="tl-modal__label" htmlFor="tl-override-reason">
          Reason (required)
        </label>
        <textarea
          id="tl-override-reason"
          className="tl-modal__textarea"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. QR code damaged, verified by serial number…"
          rows={3}
          autoFocus
        />
        <div className="tl-modal__actions">
          <button className="tl-btn tl-btn--secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="tl-btn tl-btn--primary"
            onClick={() => onConfirm(reason)}
            disabled={reason.trim().length === 0}
          >
            Confirm override
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Flag issue drawer ──────────────────────────────────────────────────────────

interface FlagDrawerProps {
  cylinderId: string
  onSubmit: (cylinderId: string, notes: string) => Promise<void>
  onClose: () => void
}

function FlagDrawer({ cylinderId, onSubmit, onClose }: FlagDrawerProps) {
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit() {
    if (!notes.trim()) return
    setSubmitting(true)
    await onSubmit(cylinderId, notes)
    setSubmitting(false)
    setSubmitted(true)
    setTimeout(onClose, 1200)
  }

  return (
    <div className="tl-drawer-backdrop" role="dialog" aria-modal="true" aria-label="Flag missing cylinder">
      <div className="tl-drawer">
        <div className="tl-drawer__header">
          <span className="tl-drawer__title">Flag Missing Cylinder</span>
          <button className="tl-drawer__close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {submitted ? (
          <div className="tl-drawer__success">✓ Issue reported to dispatch.</div>
        ) : (
          <>
            <p className="tl-drawer__body">
              Cylinder: <strong>{cylinderId || 'unspecified'}</strong>
            </p>
            <label className="tl-drawer__label" htmlFor="tl-flag-notes">Notes</label>
            <textarea
              id="tl-flag-notes"
              className="tl-drawer__textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Describe the issue — e.g. cylinder not found in warehouse…"
              rows={4}
              autoFocus
            />
            <button
              className="tl-btn tl-btn--primary tl-btn--full"
              onClick={handleSubmit}
              disabled={submitting || notes.trim().length === 0}
            >
              {submitting ? 'Sending…' : 'Report to dispatch'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function TruckLoadPage() {
  const { runId } = useParams<{ runId: string }>()
  const { role, user } = useAuth()
  const navigate = useNavigate()

  // Run doc (for name + date display only)
  const [run, setRun] = useState<Run | null>(null)
  useEffect(() => {
    if (!runId) return
    return onSnapshot(doc(db, 'runs', runId), (snap) => {
      setRun(snap.exists() ? ({ id: snap.id, ...snap.data() } as Run) : null)
    })
  }, [runId])

  const {
    manifest,
    scannedIds,
    adHocCount,
    progress,
    allScanned,
    loading,
    isStarting,
    handleScan,
    startRun,
    flagMissingCylinder,
  } = useTruckLoad(runId)

  // ── UI state ─────────────────────────────────────────────────────────────────
  // null = scanner closed; '' = ad-hoc scan; any string = cylinderId being confirmed
  const [scanTargetId,  setScanTargetId]       = useState<string | null>(null)
  const [lastResult,    setLastResult]         = useState<ScanResult | null>(null)
  const resultKey = useRef(0)

  // Flag drawer
  const [flagDrawerOpen, setFlagDrawerOpen]   = useState(false)
  const [flagCylinderId, setFlagCylinderId]   = useState('')

  // Override modal (dispatch/admin only)
  const [overrideItem, setOverrideItem]       = useState<ManifestItem | null>(null)

  // Not-in-manifest flag helper
  const [notInManifestId, setNotInManifestId] = useState<string | null>(null)

  const canOverride = role === 'admin' || role === 'dispatch'

  // ── Process incoming scan ────────────────────────────────────────────────────
  const processScan = useCallback(async (rawValue: string) => {
    setScanTargetId(null)  // Close scanner drawer immediately on any scan
    const result = await handleScan(rawValue)
    resultKey.current += 1
    setLastResult(result)

    if (result.status === 'notInManifest') {
      setNotInManifestId(rawValue)
    } else {
      setNotInManifestId(null)
    }
  // setScanTargetId is a stable React state setter — safe to omit from deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleScan])

  // ── Manifest grouped by stop ─────────────────────────────────────────────────
  const grouped = useMemo(() => groupByStop(manifest), [manifest])

  // ── Override confirm ──────────────────────────────────────────────────────────
  async function handleOverrideConfirm(reason: string) {
    if (!overrideItem || !runId || !user) return

    const now = serverTimestamp()
    // Write directly — dispatch/admin override bypasses the QR scan
    await setDoc(
      doc(db, 'runs', runId, 'manifest', overrideItem.cylinderId),
      {
        scanned: true,
        scannedAt: now,
        scannedBy: user.id,
        overrideReason: reason,
        overriddenBy: user.id,
      },
      { merge: true },
    )
    await setDoc(
      doc(db, 'cylinders', overrideItem.cylinderId),
      { status: 'onTruck', currentRunId: runId, lastScannedAt: now, lastScannedBy: user.id },
      { merge: true },
    )
    setOverrideItem(null)
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="tl-page">
        <div className="tl-center">
          <span className="tl-spinner" />
          <p className="tl-center__text">Loading manifest…</p>
        </div>
      </div>
    )
  }

  // Resolved from manifest when a specific item scan is active
  const scanTargetItem = scanTargetId != null && scanTargetId !== ''
    ? manifest.find((m) => m.cylinderId === scanTargetId) ?? null
    : null

  return (
    <div className="tl-page">

      {/* ── Header ── */}
      <div className="tl-header">
        <button
          className="tl-back-btn"
          onClick={() => navigate('/driver/schedule')}
          aria-label="Back to schedule"
        >
          ← Back
        </button>
        <div className="tl-header__title">
          Load Truck
          {run?.runNumber ? ` — ${run.runNumber}` : ''}
        </div>
        <div className="tl-header__subtitle">
          {fmtDate(run?.scheduledDate)} · {progress.total} cylinder{progress.total !== 1 ? 's' : ''} required
        </div>
        <div className="tl-header__progress" aria-live="polite">
          <span className="tl-progress-counter">
            {progress.total > 0
              ? `${progress.scanned} of ${progress.total} scanned`
              : adHocCount > 0
              ? `${adHocCount} cylinder${adHocCount !== 1 ? 's' : ''} scanned`
              : 'Scan cylinders to begin'}
          </span>
        </div>
      </div>

      {/* ── All-loaded banner ── */}
      {allScanned && (
        <div className="tl-all-loaded" role="status">
          <span className="tl-all-loaded__icon" aria-hidden="true">✅</span>
          <div className="tl-all-loaded__text">
            <div className="tl-all-loaded__title">
              {progress.total > 0
                ? `All ${progress.total} cylinders loaded.`
                : `${adHocCount} cylinder${adHocCount !== 1 ? 's' : ''} loaded.`}
            </div>
            <div className="tl-all-loaded__sub">Ready to start your run.</div>
          </div>
        </div>
      )}

      {/* ── Scan feedback & prompts (shown after scan, before all are done) ── */}
      {!allScanned && (
        <>
          {lastResult && (
            <ScanFeedback
              key={resultKey.current}
              result={lastResult}
              onDismiss={() => setLastResult(null)}
            />
          )}

          {/* Not-in-manifest flag prompt */}
          {notInManifestId && !flagDrawerOpen && (
            <div className="tl-not-in-manifest">
              <span className="tl-not-in-manifest__text">
                Not on today's manifest — <code>{notInManifestId}</code>
              </span>
              <button
                className="tl-btn tl-btn--warn-sm"
                onClick={() => {
                  setFlagCylinderId(notInManifestId)
                  setFlagDrawerOpen(true)
                  setNotInManifestId(null)
                }}
              >
                Flag for dispatch
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Manifest list ── */}
      {manifest.length > 0 && (
        <div className="tl-manifest">
          <h2 className="tl-manifest__heading">Manifest</h2>
          {[...grouped.entries()].map(([seq, items]) => (
            <StopGroup
              key={seq}
              stopSequence={seq}
              customerName={items[0].customerName}
              items={items}
              scannedIds={scannedIds}
              canOverride={canOverride}
              onOverride={setOverrideItem}
              onScanClick={(id) => { setLastResult(null); setScanTargetId(id) }}
            />
          ))}
          {/* Allow scanning cylinders not in the manifest */}
          {!allScanned && (
            <button
              className="tl-adhoc-scan-btn"
              onClick={() => { setLastResult(null); setScanTargetId('') }}
            >
              📷 Scan additional cylinder
            </button>
          )}
        </div>
      )}

      {manifest.length === 0 && !loading && (
        <div className="tl-empty">
          <p className="tl-empty__text">
            {adHocCount > 0
              ? `${adHocCount} cylinder${adHocCount !== 1 ? 's' : ''} loaded`
              : 'No pre-loaded manifest for this run.'}
          </p>
          <p className="tl-empty__hint">
            {adHocCount > 0
              ? 'Scan more cylinders or tap "Start Run" when done.'
              : "Scan each cylinder's QR code to confirm it's loaded. Each scan is recorded automatically."}
          </p>
          {!allScanned && (
            <button
              className="tl-adhoc-scan-btn"
              onClick={() => { setLastResult(null); setScanTargetId('') }}
            >
              📷 Scan cylinder
            </button>
          )}
        </div>
      )}

      {/* ── Sticky footer ── */}
      <div className="tl-footer">
        <span className="tl-footer__count">
          {progress.total > 0
            ? `${progress.scanned} / ${progress.total} scanned`
            : `${adHocCount} scanned`}
        </span>

        <button
          className={`tl-btn tl-btn--start ${allScanned ? 'tl-btn--start-active' : 'tl-footer__cta--disabled'}`.trim()}
          onClick={allScanned ? startRun : undefined}
          disabled={!allScanned || isStarting}
          aria-disabled={!allScanned}
        >
          {isStarting ? 'Starting…' : 'Start Run'}
        </button>

        <button
          className="tl-btn tl-btn--flag"
          onClick={() => {
            setFlagCylinderId('')
            setFlagDrawerOpen(true)
          }}
        >
          ⚑ Flag issue
        </button>
      </div>

      {/* ── Scanner drawer ── */}
      {scanTargetId !== null && (
        <div className="tl-scan-drawer-backdrop" role="dialog" aria-modal="true" aria-label="Scan cylinder QR code">
          <div className="tl-scan-drawer">
            <div className="tl-scan-drawer__header">
              <div className="tl-scan-drawer__context">
                {scanTargetItem ? (
                  <>
                    <span className="tl-scan-drawer__action">Confirm loaded</span>
                    <span className="tl-scan-drawer__product">
                      {scanTargetItem.productName} {scanTargetItem.sizeLabel}
                    </span>
                    {scanTargetItem.stopSequence > 0 && (
                      <span className="tl-scan-drawer__stop">
                        Stop #{scanTargetItem.stopSequence} · {scanTargetItem.customerName}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="tl-scan-drawer__action">Scan cylinder QR code</span>
                )}
              </div>
              <button
                className="tl-scan-drawer__close"
                onClick={() => setScanTargetId(null)}
                aria-label="Cancel scan"
              >
                ✕
              </button>
            </div>
            <div className="tl-scan-drawer__scanner">
              <QRScanner
                isActive={true}
                onScan={processScan}
                onError={(err) => console.warn('[TruckLoadPage] scanner error:', err)}
              />
            </div>
            <p className="tl-scan-drawer__hint">Point the rear camera at the QR code</p>
          </div>
        </div>
      )}

      {/* ── Override modal ── */}
      {overrideItem && (
        <OverrideModal
          item={overrideItem}
          onConfirm={handleOverrideConfirm}
          onCancel={() => setOverrideItem(null)}
        />
      )}

      {/* ── Flag drawer ── */}
      {flagDrawerOpen && (
        <FlagDrawer
          cylinderId={flagCylinderId}
          onSubmit={flagMissingCylinder}
          onClose={() => {
            setFlagDrawerOpen(false)
            setFlagCylinderId('')
          }}
        />
      )}

    </div>
  )
}
