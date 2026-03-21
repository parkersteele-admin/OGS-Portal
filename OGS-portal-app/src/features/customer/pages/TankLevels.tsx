/**
 * src/pages/customer/TankLevels.tsx
 * Customer portal — My Tanks (tank levels + update + refill CTA)
 *
 * Route: /portal/tanks  (replaces TanksPage placeholder)
 *
 * Each deployed tank shows:
 *  • Visual level bar (green ≥50%, amber 25–49%, red <25%)
 *  • Inline slider + number input to update level → tankService.updateTankLevel
 *  • Optimistic UI + "Level updated" toast
 *  • Refill prompt when updated level < 25%
 *  • Refill CTA card when current level < 30%
 *  • Level history accordion (subcollection customers/{id}/tanks/{tid}/levelHistory)
 *
 * Empty state: "No tanks currently on rental."
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react'
import { useNavigate } from 'react-router-dom'
import {
  collection,
  addDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import { useAuth } from '../../../hooks/useAuth'
import { useCustomerTanks } from '../../../hooks/useCustomerTanks'
import { updateTankLevel } from '../../../services/tankService'
import type { Tank } from '../../../types/tank'
import { formatDate } from '../../../utils/format'
import './TankLevels.css'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LevelEntry {
  id:          string
  levelPct:    number
  updatedBy:   string     // 'Customer' | 'Driver' | display name
  updatedByRole: string
  createdAt:   { toDate: () => Date } | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const REFILL_THRESHOLD   = 30   // show CTA at/below this level
const PROMPT_THRESHOLD   = 25   // "want to order a refill?" prompt after update
const LEVEL_GREEN_MIN    = 50
const LEVEL_AMBER_MIN    = 25

// ── Helpers ───────────────────────────────────────────────────────────────────

function levelColor(pct: number): 'green' | 'amber' | 'red' {
  if (pct >= LEVEL_GREEN_MIN) return 'green'
  if (pct >= LEVEL_AMBER_MIN) return 'amber'
  return 'red'
}

function tankLabel(tank: Tank): string {
  return `${tank.gasType} ${tank.sizeLabel}`.trim()
}

// ── Toast ──────────────────────────────────────────────────────────────────────

function Toast({
  message,
  variant,
  onDone,
}: {
  message: string
  variant: 'success' | 'error'
  onDone:  () => void
}): React.ReactElement {
  useEffect(() => {
    const t = setTimeout(onDone, 3200)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div
      className={`tl-toast tl-toast--${variant}`}
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  )
}

// ── Level history accordion ───────────────────────────────────────────────────

function LevelHistory({
  customerId,
  tankId,
}: {
  customerId: string
  tankId:     string
}): React.ReactElement {
  const [open,    setOpen]    = useState(false)
  const [entries, setEntries] = useState<LevelEntry[]>([])
  const [loaded,  setLoaded]  = useState(false)

  // Lazy-load history only when expanded
  useEffect(() => {
    if (!open || loaded) return
    const col = collection(db, `customers/${customerId}/tanks/${tankId}/levelHistory`)
    const q   = query(col, orderBy('createdAt', 'desc'))
    const unsub = onSnapshot(q, (snap) => {
      setEntries(
        snap.docs.map((d: QueryDocumentSnapshot) => ({
          id:            d.id,
          levelPct:      (d.data() as LevelEntry).levelPct,
          updatedBy:     (d.data() as LevelEntry).updatedBy,
          updatedByRole: (d.data() as LevelEntry).updatedByRole,
          createdAt:     (d.data() as LevelEntry).createdAt,
        })),
      )
      setLoaded(true)
    })
    return unsub
  }, [open, loaded, customerId, tankId])

  return (
    <div className="tl-history">
      <button
        className="tl-history__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          className={`tl-history__chevron${open ? ' tl-history__chevron--open' : ''}`}
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Level history
      </button>

      {open && (
        <div className="tl-history__body">
          {!loaded ? (
            <p className="tl-history__loading">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="tl-history__empty">No history recorded yet.</p>
          ) : (
            <table className="tl-history__table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Level</th>
                  <th>Updated by</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td>
                      {e.createdAt ? formatDate(e.createdAt) : '—'}
                    </td>
                    <td>
                      <span
                        className={`tl-history__pct tl-history__pct--${levelColor(e.levelPct)}`}
                      >
                        {e.levelPct}%
                      </span>
                    </td>
                    <td>{e.updatedBy || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

// ── Refill CTA card ────────────────────────────────────────────────────────────

function RefillCTA({
  tank,
  onOrder,
}: {
  tank:    Tank
  onOrder: () => void
}): React.ReactElement {
  return (
    <div className="tl-refill-cta" role="alert">
      <div className="tl-refill-cta__inner">
        <svg
          className="tl-refill-cta__icon"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <div>
          <p className="tl-refill-cta__title">
            {tankLabel(tank)} is running low
          </p>
          <p className="tl-refill-cta__body">
            Your tank is at{' '}
            <strong>{tank.currentLevelPct ?? 0}%</strong>. Order a refill
            before you run out.
          </p>
        </div>
      </div>
      <button className="tl-refill-cta__btn" onClick={onOrder}>
        Order a refill
      </button>
    </div>
  )
}

// ── Refill prompt (post-update) ────────────────────────────────────────────────

function RefillPrompt({
  onOrder,
  onDismiss,
}: {
  onOrder:   () => void
  onDismiss: () => void
}): React.ReactElement {
  return (
    <div className="tl-refill-prompt" role="alert">
      <p className="tl-refill-prompt__text">
        Level is below 25% — would you like to place a refill order?
      </p>
      <div className="tl-refill-prompt__actions">
        <button className="tl-refill-prompt__order" onClick={onOrder}>
          Yes, order a refill
        </button>
        <button className="tl-refill-prompt__dismiss" onClick={onDismiss}>
          Not now
        </button>
      </div>
    </div>
  )
}

// ── Tank card ──────────────────────────────────────────────────────────────────

interface TankCardProps {
  tank:       Tank
  customerId: string
  userName:   string
  onRefill:   (tank: Tank) => void
}

function TankCard({
  tank,
  customerId,
  userName,
  onRefill,
}: TankCardProps): React.ReactElement {
  const [pendingLevel, setPendingLevel]     = useState<number | null>(null)
  const [inputValue,   setInputValue]       = useState<number>(
    tank.currentLevelPct ?? 0,
  )
  const [isSaving,     setIsSaving]         = useState(false)
  const [showPrompt,   setShowPrompt]       = useState(false)
  const [toast,        setToast]            = useState<{
    message: string
    variant: 'success' | 'error'
  } | null>(null)
  const toastKey = useRef(0)

  // Keep inputValue in sync when Firestore updates the tank
  const activePct =
    pendingLevel !== null ? pendingLevel : (tank.currentLevelPct ?? 0)

  const color = levelColor(activePct)

  function fireToast(message: string, variant: 'success' | 'error') {
    toastKey.current += 1
    setToast({ message, variant })
  }

  async function handleUpdate() {
    if (inputValue === (tank.currentLevelPct ?? 0)) return
    setIsSaving(true)
    const prev = tank.currentLevelPct ?? 0

    // Optimistic update
    setPendingLevel(inputValue)

    try {
      await updateTankLevel(tank.id, inputValue)

      // Write history entry
      const histCol = collection(
        db,
        `customers/${customerId}/tanks/${tank.id}/levelHistory`,
      )
      await addDoc(histCol, {
        levelPct:      inputValue,
        previousPct:   prev,
        updatedBy:     userName,
        updatedByRole: 'customer',
        createdAt:     serverTimestamp(),
      })

      setPendingLevel(null)
      fireToast('Level updated', 'success')

      if (inputValue < PROMPT_THRESHOLD) {
        setShowPrompt(true)
      }
    } catch (err: unknown) {
      // Roll back optimistic update
      setPendingLevel(null)
      setInputValue(tank.currentLevelPct ?? 0)
      fireToast(
        err instanceof Error ? err.message : 'Failed to update level.',
        'error',
      )
    } finally {
      setIsSaving(false)
    }
  }

  const showRefillCta =
    !showPrompt &&
    (tank.currentLevelPct ?? 0) <= REFILL_THRESHOLD &&
    tank.currentLevelPct !== undefined

  return (
    <div className={`tl-card tl-card--${color}`}>
      {/* Toast */}
      {toast && (
        <Toast
          key={toastKey.current}
          message={toast.message}
          variant={toast.variant}
          onDone={() => setToast(null)}
        />
      )}

      {/* Card header */}
      <div className="tl-card__header">
        <div className="tl-card__name-block">
          <h2 className="tl-card__name">{tankLabel(tank)}</h2>
          <span className="tl-card__serial">{tank.serialNumber}</span>
        </div>
        <span className={`tl-card__pct tl-card__pct--${color}`}>
          {activePct}%
        </span>
      </div>

      {/* Level bar */}
      <div className="tl-bar" aria-hidden="true">
        <div
          className={`tl-bar__fill tl-bar__fill--${color}`}
          style={{ width: `${activePct}%` }}
        />
      </div>

      {/* Last updated */}
      {tank.currentLevelPct !== undefined && (
        <p className="tl-card__updated">
          Last updated — tap slider below to report new level
        </p>
      )}

      {/* Refill CTA */}
      {showRefillCta && (
        <RefillCTA tank={tank} onOrder={() => onRefill(tank)} />
      )}

      {/* Refill prompt (post-update) */}
      {showPrompt && (
        <RefillPrompt
          onOrder={() => { setShowPrompt(false); onRefill(tank) }}
          onDismiss={() => setShowPrompt(false)}
        />
      )}

      {/* Update level section */}
      <div className="tl-update">
        <label className="tl-update__label" htmlFor={`slider-${tank.id}`}>
          Update level
        </label>

        <div className="tl-update__controls">
          <input
            id={`slider-${tank.id}`}
            className={`tl-update__slider tl-update__slider--${color}`}
            type="range"
            min={0}
            max={100}
            step={1}
            value={inputValue}
            onChange={(e) => setInputValue(Number(e.target.value))}
          />
          <div className="tl-update__number-wrap">
            <input
              className="tl-update__number"
              type="number"
              min={0}
              max={100}
              value={inputValue}
              onChange={(e) =>
                setInputValue(
                  Math.min(100, Math.max(0, Number(e.target.value))),
                )
              }
            />
            <span className="tl-update__pct-sign" aria-hidden="true">%</span>
          </div>
        </div>

        <button
          className="tl-update__btn"
          disabled={
            isSaving || inputValue === (tank.currentLevelPct ?? 0)
          }
          onClick={handleUpdate}
        >
          {isSaving ? 'Saving…' : 'Update level'}
        </button>
      </div>

      {/* Level history */}
      <LevelHistory customerId={customerId} tankId={tank.id} />
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const TankLevels: React.FC = () => {
  const { user }   = useAuth()
  const navigate   = useNavigate()
  const customerId = user?.customerId ?? ''
  const userName   = user?.name ?? 'Customer'

  const { tanks, loading, error } = useCustomerTanks(customerId)

  // Only show deployed tanks
  const deployedTanks = tanks.filter((t) => t.status === 'deployed')

  const handleRefill = useCallback(
    (tank: Tank) => {
      navigate('/portal/order', {
        state: {
          reorder: {
            tankId:    tank.id,
            productId: '',
            quantity:  1,
            tier:      'standard',
            notes:     `Refill for ${tankLabel(tank)} (S/N ${tank.serialNumber})`,
          },
        },
      })
    },
    [navigate],
  )

  return (
    <div className="tl-page">
      <div className="tl-header">
        <h1 className="tl-header__title">My Tanks</h1>
        <p className="tl-header__sub">
          Report current levels and order refills.
        </p>
      </div>

      {loading ? (
        <div className="tl-skeleton">
          {[0, 1].map((i) => (
            <div key={i} className="tl-skeleton__card" />
          ))}
        </div>
      ) : error ? (
        <div className="tl-error" role="alert">
          Failed to load tanks. Please refresh.
        </div>
      ) : deployedTanks.length === 0 ? (
        <div className="tl-empty">
          <svg
            width="40"
            height="40"
            viewBox="0 0 40 40"
            fill="none"
            aria-hidden="true"
            className="tl-empty__icon"
          >
            <circle cx="20" cy="20" r="19" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
            <rect x="15" y="8" width="10" height="24" rx="4" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
            <rect x="18" y="6" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
          </svg>
          <p className="tl-empty__title">No tanks currently on rental.</p>
          <p className="tl-empty__body">
            Contact Ohio Gas Supply to get started.
          </p>
        </div>
      ) : (
        <div className="tl-grid">
          {deployedTanks.map((tank) => (
            <TankCard
              key={tank.id}
              tank={tank}
              customerId={customerId}
              userName={userName}
              onRefill={handleRefill}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default TankLevels
