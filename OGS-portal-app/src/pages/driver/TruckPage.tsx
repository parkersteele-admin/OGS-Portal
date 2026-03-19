/**
 * src/pages/driver/TruckPage.tsx
 *
 * Driver "My Truck" page at /driver/truck
 *
 * Features:
 *   - QR scanner (camera) to scan a tank ID embedded in QR code
 *   - Check OUT tank from inventory → truck (must be status: available)
 *   - Check IN empty tank back from customer → returned
 *   - View tanks currently on truck
 *   - View pending returns (deployed tanks the driver delivered, needing check-in)
 *   - Rule: cannot check OUT more tanks if any delivered tanks haven't been checked in
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { onSnapshot, query, where } from 'firebase/firestore'
import jsQR from 'jsqr'
import { tanksCol } from '../../lib/firestore'
import {
  getTank,
  loadTankToTruck,
  checkInEmptyTank,
  subscribeToDriverTruckTanks,
} from '../../services/tankService'
import { useAuth } from '../../hooks/useAuth'
import type { Tank } from '../../types/tank'
import './TruckPage.css'

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractTankId(raw: string): string | null {
  // Handles both formats:
  //   https://ogs-portal.web.app/driver/truck?scan=TANK_ID
  //   TANK_ID  (plain)
  //
  // IMPORTANT: never return the raw URL — Firestore rejects paths with `//`.
  const cleaned = raw.trim()
  if (cleaned.includes('://')) {
    try {
      const url = new URL(cleaned)
      return url.searchParams.get('scan') || null
    } catch {
      return null  // Unparseable URL — reject
    }
  }
  return cleaned || null
}

function fmtStatus(s: string) {
  const map: Record<string, string> = {
    available:  'Available',
    on_truck:   'On Truck',
    deployed:   'At Customer',
    returned:   'Returned',
    inspection: 'Inspection',
  }
  return map[s] ?? s
}

// ── QR Scanner component ───────────────────────────────────────────────────────

interface QRScannerProps {
  onScan: (tankId: string) => void
  onClose: () => void
}

const QRScanner: React.FC<QRScannerProps> = ({ onScan, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)
  const [error, setError] = useState('')
  const [scanning, setScanning] = useState(false)

  const tick = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(tick)
      return
    }
    canvas.width  = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) { rafRef.current = requestAnimationFrame(tick); return }
    ctx.drawImage(video, 0, 0)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' })
    if (code?.data) {
      const tankId = extractTankId(code.data)
      if (tankId) { onScan(tankId); return }
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [onScan])

  useEffect(() => {
    let mounted = true
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        if (!mounted) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play()
          setScanning(true)
          rafRef.current = requestAnimationFrame(tick)
        }
      })
      .catch((e) => {
        if (!mounted) return
        setError(e.name === 'NotAllowedError'
          ? 'Camera access denied. Please allow camera permissions and try again.'
          : 'Could not start camera: ' + e.message)
      })
    return () => {
      mounted = false
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [tick])

  return (
    <div className="tp-scanner-overlay" onClick={onClose}>
      <div className="tp-scanner" onClick={(e) => e.stopPropagation()}>
        <div className="tp-scanner__header">
          <span className="tp-scanner__title">Scan Tank QR Code</span>
          <button className="tp-scanner__close" onClick={onClose}>✕</button>
        </div>

        {error ? (
          <div className="tp-scanner__error">{error}</div>
        ) : (
          <div className="tp-scanner__viewport">
            <video ref={videoRef} className="tp-scanner__video" playsInline muted />
            <canvas ref={canvasRef} className="tp-scanner__canvas" />
            {scanning && (
              <div className="tp-scanner__frame">
                <div className="tp-scanner__crosshair" />
              </div>
            )}
            {!scanning && <div className="tp-scanner__loading">Starting camera…</div>}
          </div>
        )}

        <p className="tp-scanner__hint">Point camera at the tank QR code</p>
      </div>
    </div>
  )
}

// ── Tank card on truck ─────────────────────────────────────────────────────────

interface TruckTankCardProps {
  tank:   Tank
  mode:   'on_truck' | 'deployed'
  onCheckIn: (tank: Tank) => void
}

const TruckTankCard: React.FC<TruckTankCardProps> = ({ tank, mode, onCheckIn }) => (
  <div className={`tp-tank-card tp-tank-card--${mode}`}>
    <div className="tp-tank-card__top">
      <span className="tp-tank-card__serial">{tank.serialNumber}</span>
      <span className={`tp-tank-card__status tp-tank-card__status--${tank.status}`}>
        {fmtStatus(tank.status)}
      </span>
    </div>
    <div className="tp-tank-card__info">
      {tank.gasType} · {tank.sizeLabel}
    </div>
    {mode === 'deployed' && (
      <button className="tp-tank-card__checkin" onClick={() => onCheckIn(tank)}>
        ↩ Check In Empty
      </button>
    )}
  </div>
)

// ── Confirm modal ──────────────────────────────────────────────────────────────

interface ConfirmModalProps {
  title:    string
  body:     React.ReactNode
  confirm:  string
  onCancel: () => void
  onConfirm: () => void
  busy:     boolean
  danger?:  boolean
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({ title, body, confirm, onCancel, onConfirm, busy, danger }) => (
  <div className="tp-confirm-overlay" onClick={onCancel}>
    <div className="tp-confirm" onClick={(e) => e.stopPropagation()} role="dialog">
      <h3 className="tp-confirm__title">{title}</h3>
      <div className="tp-confirm__body">{body}</div>
      <div className="tp-confirm__actions">
        <button className="tp-btn tp-btn--ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className={`tp-btn ${danger ? 'tp-btn--danger' : 'tp-btn--primary'}`} onClick={onConfirm} disabled={busy}>
          {busy ? 'Processing…' : confirm}
        </button>
      </div>
    </div>
  </div>
)

// ── Main page ──────────────────────────────────────────────────────────────────

const TruckPage: React.FC = () => {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  // Tanks on this driver's truck
  const [truckTanks,    setTruckTanks]    = useState<Tank[]>([])
  // Deployed tanks the driver delivered (need check-in before loading more)
  const [deployedTanks, setDeployedTanks] = useState<Tank[]>([])
  const [loadingTanks,  setLoadingTanks]  = useState(true)

  // QR scanner
  const [showScanner,  setShowScanner]  = useState(false)

  // Scanned tank awaiting confirmation
  const [scannedTank,  setScannedTank]  = useState<Tank | null>(null)
  const [scanAction,   setScanAction]   = useState<'checkout' | 'checkin' | null>(null)
  const [scanError,    setScanError]    = useState('')
  const [confirmBusy,  setConfirmBusy]  = useState(false)

  // Toast messages
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  // Subscribe to truck tanks in real time
  useEffect(() => {
    if (!user?.id) return
    setLoadingTanks(true)
    const unsub = subscribeToDriverTruckTanks(user.id, (tanks) => {
      setTruckTanks(tanks)
      setLoadingTanks(false)
    })
    return unsub
  }, [user?.id])

  // Load deployed tanks that this driver last scanned (tracked via tankEvents)
  // For simplicity we subscribe to deployed tanks that have this driver's ID
  useEffect(() => {
    if (!user?.id) return
    const unsub = onSnapshot(
      query(tanksCol, where('status', '==', 'deployed'), where('driverId', '==', user.id)),
      (snap) => setDeployedTanks(snap.docs.map(d => ({ ...d.data(), id: d.id }) as Tank)),
    )
    return unsub
  }, [user?.id])

  // Handle ?scan=TANK_ID from QR code direct URL
  useEffect(() => {
    const tankIdFromUrl = searchParams.get('scan')
    if (!tankIdFromUrl) return
    // Remove it from URL immediately so back/refresh doesn't re-trigger
    setSearchParams({}, { replace: true })
    handleScannedId(tankIdFromUrl)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hasPendingReturns = deployedTanks.length > 0

  async function handleScannedId(rawId: string) {
    setScanError('')
    try {
      const tank = await getTank(rawId)
      if (tank.status === 'available') {
        if (hasPendingReturns) {
          setScanError(`You have ${deployedTanks.length} empty tank${deployedTanks.length > 1 ? 's' : ''} to check in first. Check them in before loading new tanks.`)
          setShowScanner(false)
          return
        }
        setScannedTank(tank)
        setScanAction('checkout')
      } else if (tank.status === 'deployed') {
        setScannedTank(tank)
        setScanAction('checkin')
      } else if (tank.status === 'on_truck') {
        if (tank.driverId === user?.id) {
          setScanError(`Tank ${tank.serialNumber} is already on your truck.`)
        } else {
          setScanError(`Tank ${tank.serialNumber} is on another driver's truck.`)
        }
        setShowScanner(false)
        return
      } else {
        setScanError(`Tank ${tank.serialNumber} is currently in status "${fmtStatus(tank.status)}" and cannot be checked out or in.`)
        setShowScanner(false)
        return
      }
      setShowScanner(false)
    } catch {
      setScanError('Tank not found. Make sure you scanned a valid OGS tank QR code.')
      setShowScanner(false)
    }
  }

  async function handleConfirmCheckout() {
    if (!scannedTank || !user) return
    setConfirmBusy(true)
    try {
      await loadTankToTruck(scannedTank.id, user.id, user.name ?? user.email ?? 'Driver')
      showToast(`✅ ${scannedTank.serialNumber} loaded to your truck.`, 'success')
      setScannedTank(null)
      setScanAction(null)
    } catch (e) {
      showToast((e as Error).message, 'error')
    } finally {
      setConfirmBusy(false)
    }
  }

  async function handleConfirmCheckin(tank: Tank) {
    if (!user) return
    setScannedTank(tank)
    setScanAction('checkin')
  }

  async function handleConfirmCheckinSubmit() {
    if (!scannedTank || !user) return
    setConfirmBusy(true)
    try {
      await checkInEmptyTank(scannedTank.id, user.id, user.name ?? user.email ?? 'Driver')
      showToast(`↩ ${scannedTank.serialNumber} checked in as empty.`, 'success')
      setScannedTank(null)
      setScanAction(null)
    } catch (e) {
      showToast((e as Error).message, 'error')
    } finally {
      setConfirmBusy(false)
    }
  }

  return (
    <div className="tp-page">

      {/* Toast */}
      {toast && (
        <div className={`tp-toast tp-toast--${toast.type}`}>{toast.msg}</div>
      )}

      {/* Header */}
      <div className="tp-header">
        <h1 className="tp-header__title">My Truck</h1>
        <button
          className="tp-scan-btn"
          onClick={() => { setScanError(''); setShowScanner(true) }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="2"/>
            <rect x="16" y="3" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="2"/>
            <rect x="3" y="16" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="2"/>
            <path d="M16 16h2v2h-2zM20 16h1v2h-1zM16 20h5v1h-5zM13 3v5M13 10v1M13 13v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          Scan Tank
        </button>
      </div>

      {/* Scan error banner */}
      {scanError && (
        <div className="tp-scan-error">
          ⚠️ {scanError}
          <button className="tp-scan-error__dismiss" onClick={() => setScanError('')}>✕</button>
        </div>
      )}

      {/* Pending returns warning */}
      {hasPendingReturns && (
        <div className="tp-warning">
          <strong>⚠️ {deployedTanks.length} empty tank{deployedTanks.length > 1 ? 's' : ''} need to be checked in</strong>
          <p>You cannot load new tanks until you check in all delivered tanks below.</p>
        </div>
      )}

      {/* Deployed tanks needing check-in */}
      {deployedTanks.length > 0 && (
        <section className="tp-section">
          <h2 className="tp-section__title tp-section__title--warn">
            📦 Empties to Return ({deployedTanks.length})
          </h2>
          <div className="tp-tank-list">
            {deployedTanks.map(t => (
              <TruckTankCard
                key={t.id}
                tank={t}
                mode="deployed"
                onCheckIn={handleConfirmCheckin}
              />
            ))}
          </div>
        </section>
      )}

      {/* Tanks on truck */}
      <section className="tp-section">
        <h2 className="tp-section__title">
          🚛 On Truck {!loadingTanks && `(${truckTanks.length})`}
        </h2>
        {loadingTanks ? (
          <div className="tp-loading">Loading…</div>
        ) : truckTanks.length === 0 ? (
          <div className="tp-empty">No tanks loaded. Scan a QR code to load tanks.</div>
        ) : (
          <div className="tp-tank-list">
            {truckTanks.map(t => (
              <TruckTankCard
                key={t.id}
                tank={t}
                mode="on_truck"
                onCheckIn={handleConfirmCheckin}
              />
            ))}
          </div>
        )}
      </section>

      {/* QR Scanner */}
      {showScanner && (
        <QRScanner
          onScan={handleScannedId}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* Confirm check-out modal */}
      {scannedTank && scanAction === 'checkout' && (
        <ConfirmModal
          title="Load Tank to Truck?"
          body={
            <div className="tp-confirm__tank-info">
              <div className="tp-confirm__serial">{scannedTank.serialNumber}</div>
              <div className="tp-confirm__meta">{scannedTank.gasType} · {scannedTank.sizeLabel}</div>
              <div className="tp-confirm__status">Status: {fmtStatus(scannedTank.status)}</div>
            </div>
          }
          confirm="✓ Load to Truck"
          onCancel={() => { setScannedTank(null); setScanAction(null) }}
          onConfirm={handleConfirmCheckout}
          busy={confirmBusy}
        />
      )}

      {/* Confirm check-in modal */}
      {scannedTank && scanAction === 'checkin' && (
        <ConfirmModal
          title="Check In Empty Tank?"
          body={
            <div className="tp-confirm__tank-info">
              <div className="tp-confirm__serial">{scannedTank.serialNumber}</div>
              <div className="tp-confirm__meta">{scannedTank.gasType} · {scannedTank.sizeLabel}</div>
              <div className="tp-confirm__status">This will mark the tank as returned to warehouse.</div>
            </div>
          }
          confirm="↩ Check In Empty"
          onCancel={() => { setScannedTank(null); setScanAction(null) }}
          onConfirm={handleConfirmCheckinSubmit}
          busy={confirmBusy}
        />
      )}
    </div>
  )
}

export default TruckPage
