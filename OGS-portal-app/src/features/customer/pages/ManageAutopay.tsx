/**
 * src/pages/customer/ManageAutopay.tsx
 * Customer portal — Manage Payment Methods & Autopay
 *
 * Route: /portal/autopay
 *
 * Sections:
 *  1. Autopay status card   — live toggle, next-charge method preview
 *  2. Saved payment methods — autopay/default badges, inline remove-confirm,
 *                             "Set as autopay" per card
 *  3. Add payment method    — Card / ACH buttons → Modal → Stripe flow → toast
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  onSnapshot,
  doc,
  updateDoc,
  getDocs,
} from 'firebase/firestore'
import { useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js'
import { useAuth }           from '../../../hooks/useAuth'
import { usePaymentMethods } from '../../../hooks/usePaymentMethods'
import { StripeProvider }    from '../../../components/payments/StripeProvider'
import { Modal }             from '../../../components/ui/Modal'
import { Badge }             from '../../../components/ui/Badge'
import { Button }            from '../../../components/ui/Button'
import {
  createSetupIntent,
  savePaymentMethod,
  removePaymentMethod,
} from '../../../services/paymentMethodService'
import { db }                from '../../../lib/firebase'
import { paymentMethodsCol } from '../../../lib/firestore'
import type { PaymentMethod } from '../../../types/billing'
import type { Customer }      from '../../../types/customer'
import './ManageAutopay.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type AddMode = 'card' | 'ach'

interface ToastState {
  message: string
  type:    'success' | 'error'
}

// ── Brand chip icons ──────────────────────────────────────────────────────────

const BRAND_LABELS: Record<string, string> = {
  visa:       'Visa',
  mastercard: 'Mastercard',
  amex:       'Amex',
  discover:   'Discover',
  jcb:        'JCB',
  unionpay:   'UnionPay',
  diners:     'Diners',
}

function BrandChip({ brand }: { brand?: string }): React.ReactElement {
  const b = (brand ?? '').toLowerCase()

  if (b === 'visa') {
    return <div className="pm-brand pm-brand--visa" aria-label="Visa"><span>VISA</span></div>
  }
  if (b === 'mastercard') {
    return (
      <div className="pm-brand pm-brand--mc" aria-label="Mastercard">
        <span className="pm-brand__mc-l" aria-hidden="true" />
        <span className="pm-brand__mc-r" aria-hidden="true" />
      </div>
    )
  }
  if (b === 'amex') {
    return <div className="pm-brand pm-brand--amex" aria-label="American Express"><span>AMEX</span></div>
  }
  if (b === 'discover') {
    return <div className="pm-brand pm-brand--discover" aria-label="Discover"><span>D</span></div>
  }

  // Generic card
  return (
    <div className="pm-brand pm-brand--generic" aria-label="Card">
      <svg width="28" height="18" viewBox="0 0 28 18" fill="none" aria-hidden="true">
        <rect width="28" height="18" rx="3" fill="#e0e0e0" />
        <rect y="4" width="28" height="4" fill="#bdbdbd" />
        <rect x="3" y="11" width="7" height="2.5" rx="1" fill="#bdbdbd" />
      </svg>
    </div>
  )
}

function BankChip(): React.ReactElement {
  return (
    <div className="pm-brand pm-brand--bank" aria-label="Bank account">
      <svg width="28" height="20" viewBox="0 0 28 20" fill="none" aria-hidden="true">
        <rect width="28" height="20" rx="3" fill="#EDF4FF" />
        <path d="M14 2L23 7H5L14 2Z" fill="#378ADD" />
        <rect x="6"  y="8"  width="3" height="5" fill="#378ADD" />
        <rect x="12" y="8"  width="3" height="5" fill="#378ADD" />
        <rect x="18" y="8"  width="3" height="5" fill="#378ADD" />
        <rect x="4"  y="14" width="20" height="2" rx="1" fill="#378ADD" />
      </svg>
    </div>
  )
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({
  state,
  onDone,
}: {
  state:  ToastState
  onDone: () => void
}): React.ReactElement {
  useEffect(() => {
    const t = setTimeout(onDone, 3500)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div className={`pm-toast pm-toast--${state.type}`} role="status" aria-live="polite">
      {state.type === 'success' && <span className="pm-toast__icon" aria-hidden="true">✓</span>}
      {state.message}
    </div>
  )
}

// ── Add method inner form (must be inside <StripeProvider>) ───────────────────

interface AddMethodFormProps {
  setupIntentId: string
  mode:          AddMode
  customerId:    string
  onSuccess:     () => void
  onCancel:      () => void
}

function AddMethodForm({
  setupIntentId,
  mode,
  customerId,
  onSuccess,
  onCancel,
}: AddMethodFormProps): React.ReactElement {
  const stripe   = useStripe()
  const elements = useElements()

  const [setAsDefault, setSetAsDefault] = useState(true)
  const [useForAutopay, setUseForAutopay] = useState(true)
  const [loading, setLoading]           = useState(false)
  const [error,   setError]             = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return

    setError(null)
    setLoading(true)

    const { error: submitErr } = await elements.submit()
    if (submitErr) {
      setError(submitErr.message ?? 'Check your payment details.')
      setLoading(false)
      return
    }

    const { error: confirmErr, setupIntent } = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    })

    if (confirmErr) {
      setError(confirmErr.message ?? 'Could not save payment method.')
      setLoading(false)
      return
    }

    try {
      await savePaymentMethod({
        setupIntentId: setupIntent?.id ?? setupIntentId,
        setAsDefault,
        customerId,
      })

      // If "use for autopay" checked, wire up the customer doc immediately
      if (useForAutopay && setupIntent?.payment_method) {
        const stripePmId =
          typeof setupIntent.payment_method === 'string'
            ? setupIntent.payment_method
            : setupIntent.payment_method.id
        await updateDoc(doc(db, 'customers', customerId), {
          autopayEnabled:               true,
          autopayStripePaymentMethodId: stripePmId,
        })
      }

      onSuccess()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save payment method.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="pm-add-form">
      <PaymentElement
        options={{
          layout: 'tabs',
          paymentMethodOrder:
            mode === 'ach'
              ? ['us_bank_account', 'card']
              : ['card', 'us_bank_account'],
        }}
      />

      {mode === 'ach' && (
        <p className="pm-add-form__ach-note">
          Bank transfers take 3–5 business days to settle.
        </p>
      )}

      <div className="pm-add-form__checks">
        <label className="pm-add-form__check">
          <input
            type="checkbox"
            checked={setAsDefault}
            onChange={(e) => setSetAsDefault(e.target.checked)}
          />
          Set as default payment method
        </label>
        <label className="pm-add-form__check">
          <input
            type="checkbox"
            checked={useForAutopay}
            onChange={(e) => setUseForAutopay(e.target.checked)}
          />
          Use for autopay
        </label>
      </div>

      {error && (
        <div className="pm-add-form__error" role="alert">
          {error}
          <button
            type="button"
            className="pm-add-form__dismiss"
            onClick={() => setError(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <div className="pm-add-form__actions">
        <Button
          type="button"
          variant="ghost"
          size="md"
          onClick={onCancel}
          disabled={loading}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="md"
          loading={loading}
          disabled={!stripe}
        >
          Save payment method
        </Button>
      </div>
    </form>
  )
}

// ── Add method modal ──────────────────────────────────────────────────────────

interface AddMethodModalProps {
  mode:       AddMode | null
  customerId: string
  onSuccess:  () => void
  onClose:    () => void
}

function AddMethodModal({
  mode,
  customerId,
  onSuccess,
  onClose,
}: AddMethodModalProps): React.ReactElement {
  const [clientSecret,  setClientSecret]  = useState<string | null>(null)
  const [setupIntentId, setSetupIntentId] = useState('')
  const [initError,     setInitError]     = useState<string | null>(null)
  const initLoading = mode !== null && !clientSecret && !initError

  // Fetch a fresh SetupIntent every time the modal opens
  useEffect(() => {
    if (!mode) {
      return
    }

    createSetupIntent(customerId)
      .then(({ clientSecret: cs }) => {
        setSetupIntentId(cs.split('_secret_')[0])
        setClientSecret(cs)
      })
      .catch((err: unknown) => {
        setInitError(
          err instanceof Error ? err.message : 'Could not initialise payment setup.',
        )
      })
  }, [mode, customerId])

  const title =
    mode === 'ach' ? 'Add bank account (ACH)' : 'Add credit or debit card'

  return (
    <Modal open={mode !== null} onClose={onClose} title={title} size="md">
      {initLoading && (
        <div className="pm-add-modal__loading">Setting up secure form…</div>
      )}
      {initError && (
        <div className="pm-add-modal__error" role="alert">{initError}</div>
      )}
      {clientSecret && mode && (
        <StripeProvider clientSecret={clientSecret}>
          <AddMethodForm
            setupIntentId={setupIntentId}
            mode={mode}
            customerId={customerId}
            onSuccess={onSuccess}
            onCancel={onClose}
          />
        </StripeProvider>
      )}
    </Modal>
  )
}

// ── Method card ───────────────────────────────────────────────────────────────

interface MethodCardProps {
  pm:            PaymentMethod
  isAutopay:     boolean
  autopayActive: boolean
  onSetAutopay:  (pm: PaymentMethod) => Promise<void>
  onRemove:      (pmId: string) => Promise<void>
}

function MethodCard({
  pm,
  isAutopay,
  autopayActive,
  onSetAutopay,
  onRemove,
}: MethodCardProps): React.ReactElement {
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removing,      setRemoving]      = useState(false)
  const [settingAuto,   setSettingAuto]   = useState(false)

  const isCard    = pm.type === 'card'
  const brandKey  = (pm.brand ?? '').toLowerCase()
  const brandName = BRAND_LABELS[brandKey] ?? pm.brand ?? 'Card'
  const label     = isCard
    ? `${brandName} ···· ${pm.last4}`
    : `Bank account ···· ${pm.last4}`

  async function handleRemove() {
    setRemoving(true)
    try {
      await onRemove(pm.id)
    } finally {
      setRemoving(false)
      setConfirmRemove(false)
    }
  }

  async function handleSetAutopay() {
    setSettingAuto(true)
    try {
      await onSetAutopay(pm)
    } finally {
      setSettingAuto(false)
    }
  }

  return (
    <div className={`pm-card${pm.isDefault ? ' pm-card--default' : ''}`}>
      {/* Brand icon */}
      <div className="pm-card__icon">
        {isCard ? <BrandChip brand={pm.brand} /> : <BankChip />}
      </div>

      {/* Info */}
      <div className="pm-card__info">
        <div className="pm-card__label-row">
          <span className="pm-card__label">{label}</span>
          <div className="pm-card__badges">
            {isAutopay && autopayActive && (
              <Badge variant="success">Autopay</Badge>
            )}
            {pm.isDefault && (
              <Badge variant="brand">Default</Badge>
            )}
          </div>
        </div>
        {isCard && pm.expMonth != null && pm.expYear != null && (
          <span className="pm-card__exp">
            Expires {String(pm.expMonth).padStart(2, '0')} / {pm.expYear}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="pm-card__actions">
        {!isAutopay && (
          <Button
            variant="ghost"
            size="sm"
            loading={settingAuto}
            onClick={handleSetAutopay}
          >
            Set as autopay
          </Button>
        )}

        {confirmRemove ? (
          <div className="pm-card__confirm">
            <span className="pm-card__confirm-text">Remove?</span>
            <Button
              variant="danger"
              size="sm"
              loading={removing}
              onClick={handleRemove}
            >
              Yes
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmRemove(false)}
              disabled={removing}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmRemove(true)}
          >
            Remove
          </Button>
        )}
      </div>
    </div>
  )
}

// ── Autopay status card ───────────────────────────────────────────────────────

interface AutopayCardProps {
  enabled:   boolean
  autopayPm: PaymentMethod | undefined
  toggling:  boolean
  onToggle:  (on: boolean) => void
}

function AutopayStatusCard({
  enabled,
  autopayPm,
  toggling,
  onToggle,
}: AutopayCardProps): React.ReactElement {
  let pmLabel: string | null = null
  if (autopayPm) {
    const brandKey = (autopayPm.brand ?? '').toLowerCase()
    const brandName = BRAND_LABELS[brandKey] ?? autopayPm.brand ?? (autopayPm.type === 'card' ? 'Card' : 'Bank account')
    pmLabel = `${brandName} ···· ${autopayPm.last4}`
  }

  return (
    <div className={`pm-autopay-card${enabled ? ' pm-autopay-card--on' : ''}`}>
      <div className="pm-autopay-card__status">
        <div className="pm-autopay-card__indicator">
          <span
            className={`pm-autopay-card__dot${enabled ? ' pm-autopay-card__dot--on' : ''}`}
            aria-hidden="true"
          />
          <div>
            <p className="pm-autopay-card__status-label">Autopay is</p>
            <p className="pm-autopay-card__status-value">
              {enabled ? 'On' : 'Off'}
            </p>
          </div>
        </div>

        <label
          className={`pm-toggle${toggling ? ' pm-toggle--busy' : ''}`}
          aria-label={`Turn autopay ${enabled ? 'off' : 'on'}`}
        >
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => !toggling && onToggle(e.target.checked)}
            disabled={toggling}
          />
          <span className="pm-toggle__track">
            <span className="pm-toggle__thumb" />
          </span>
        </label>
      </div>

      {enabled && pmLabel && (
        <p className="pm-autopay-card__next">
          Your next invoice will be charged automatically to{' '}
          <strong>{pmLabel}</strong>.
        </p>
      )}
      {enabled && !pmLabel && (
        <p className="pm-autopay-card__next pm-autopay-card__next--warn">
          No payment method set for autopay. Add one below.
        </p>
      )}
      {!enabled && (
        <p className="pm-autopay-card__next">
          Enable autopay so invoices are paid automatically on the due date.
        </p>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ManageAutopay(): React.ReactElement {
  const { user }   = useAuth()
  const customerId = user?.customerId ?? ''

  // Real-time customer doc — autopayEnabled + autopayStripePaymentMethodId
  const [customer, setCustomer] = useState<Customer | null>(null)
  useEffect(() => {
    if (!customerId) return
    const unsub = onSnapshot(doc(db, 'customers', customerId), (snap) => {
      if (snap.exists()) setCustomer({ id: snap.id, ...snap.data() } as Customer)
    })
    return unsub
  }, [customerId])

  // Real-time payment methods
  const { methods, loading: pmLoading, error: pmError } = usePaymentMethods(customerId)

  // UI state
  const [addMode,   setAddMode]   = useState<AddMode | null>(null)
  const [toggling,  setToggling]  = useState(false)
  const [globalErr, setGlobalErr] = useState<string | null>(null)
  const [toast,     setToast]     = useState<ToastState | null>(null)
  const toastKey = useRef(0)

  const showToast = useCallback((message: string, type: ToastState['type'] = 'success') => {
    toastKey.current += 1
    setToast({ message, type })
  }, [])

  const dismissToast = useCallback(() => setToast(null), [])

  // Derived autopay state
  const autopayEnabled    = customer?.autopayEnabled ?? false
  const autopayStripePmId = customer?.autopayStripePaymentMethodId ?? ''
  const autopayPm         = methods.find((m) => m.stripePaymentMethodId === autopayStripePmId)

  // Toggle autopay on/off
  async function handleToggle(on: boolean) {
    if (!customerId) return
    if (on && methods.length === 0) {
      setGlobalErr('Add a payment method before enabling autopay.')
      return
    }
    setToggling(true)
    try {
      await updateDoc(doc(db, 'customers', customerId), { autopayEnabled: on })
    } catch (err: unknown) {
      setGlobalErr(err instanceof Error ? err.message : 'Could not update autopay setting.')
    } finally {
      setToggling(false)
    }
  }

  // Set a specific PM as the autopay method (also sets it as default)
  const handleSetAutopay = useCallback(async (pm: PaymentMethod) => {
    if (!customerId) return
    try {
      await updateDoc(doc(db, 'customers', customerId), {
        autopayEnabled:               true,
        autopayStripePaymentMethodId: pm.stripePaymentMethodId,
      })
      // Update isDefault on all payment method docs
      const snap = await getDocs(paymentMethodsCol(customerId))
      await Promise.all(
        snap.docs.map((d) => updateDoc(d.ref, { isDefault: d.id === pm.id })),
      )
      showToast('Autopay method updated.')
    } catch (err: unknown) {
      setGlobalErr(err instanceof Error ? err.message : 'Failed to set autopay method.')
    }
  }, [customerId, showToast])

  // Remove a payment method
  const handleRemove = useCallback(async (pmId: string) => {
    try {
      await removePaymentMethod({ paymentMethodId: pmId, customerId })
      showToast('Payment method removed.')
    } catch (err: unknown) {
      setGlobalErr(err instanceof Error ? err.message : 'Failed to remove payment method.')
    }
  }, [customerId, showToast])

  // After adding a new method via the modal
  const handleAddSuccess = useCallback(() => {
    setAddMode(null)
    showToast('Payment method added successfully.')
  }, [showToast])

  return (
    <div className="pm-page">
      {/* Toast */}
      {toast && (
        <Toast key={toastKey.current} state={toast} onDone={dismissToast} />
      )}

      {/* Global error banner */}
      {globalErr && (
        <div className="pm-global-error" role="alert">
          {globalErr}
          <button
            type="button"
            className="pm-global-error__dismiss"
            onClick={() => setGlobalErr(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* Header */}
      <div className="pm-header">
        <h1 className="pm-header__title">Payment Methods &amp; Autopay</h1>
        <p className="pm-header__sub">
          Manage saved cards and bank accounts for automatic invoice payments.
        </p>
      </div>

      {/* ── Autopay status card ── */}
      {customer !== null && (
        <AutopayStatusCard
          enabled={autopayEnabled}
          autopayPm={autopayPm}
          toggling={toggling}
          onToggle={handleToggle}
        />
      )}

      {/* ── Saved payment methods ── */}
      <section className="pm-section">
        <h2 className="pm-section__title">Saved payment methods</h2>

        {pmLoading ? (
          <div className="pm-skeleton">
            {[0, 1].map((i) => (
              <div key={i} className="pm-skeleton__row" />
            ))}
          </div>
        ) : pmError ? (
          <p className="pm-error-text">Failed to load payment methods.</p>
        ) : methods.length === 0 ? (
          <div className="pm-empty">
            <p>No payment methods saved yet.</p>
            <p>Add a card or bank account below to enable autopay.</p>
          </div>
        ) : (
          <div className="pm-cards">
            {methods.map((pm) => (
              <MethodCard
                key={pm.id}
                pm={pm}
                isAutopay={pm.stripePaymentMethodId === autopayStripePmId}
                autopayActive={autopayEnabled}
                onSetAutopay={handleSetAutopay}
                onRemove={handleRemove}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Add payment method ── */}
      <section className="pm-section">
        <h2 className="pm-section__title">Add payment method</h2>

        <div className="pm-add-btns">
          <button
            type="button"
            className="pm-add-btn"
            onClick={() => setAddMode('card')}
          >
            <span className="pm-add-btn__icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <rect x="1" y="3.5" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
                <rect x="1" y="7" width="16" height="3" fill="currentColor" opacity="0.25" />
                <rect x="3" y="11" width="4" height="1.5" rx="0.75" fill="currentColor" />
              </svg>
            </span>
            + Add credit or debit card
          </button>

          <button
            type="button"
            className="pm-add-btn"
            onClick={() => setAddMode('ach')}
          >
            <span className="pm-add-btn__icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M9 1.5L16 5.5H2L9 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                <rect x="3"   y="6.5" width="2.5" height="5" rx="0.5" fill="currentColor" opacity="0.55" />
                <rect x="7.5" y="6.5" width="2.5" height="5" rx="0.5" fill="currentColor" opacity="0.55" />
                <rect x="12"  y="6.5" width="2.5" height="5" rx="0.5" fill="currentColor" opacity="0.55" />
                <rect x="1"   y="12.5" width="16" height="1.5" rx="0.75" fill="currentColor" />
              </svg>
            </span>
            + Add bank account (ACH)
          </button>
        </div>

        {/* Security note */}
        <div className="pm-security-note">
          <svg
            className="pm-security-note__icon"
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M7 1L12.5 3.5v4C12.5 11 9.5 13 7 14 4.5 13 1.5 11 1.5 7.5V3.5L7 1Z"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
          </svg>
          Your card details are securely stored by Stripe. OGS Portal never stores card numbers.
        </div>
      </section>

      {/* Add method modal */}
      <AddMethodModal
        mode={addMode}
        customerId={customerId}
        onSuccess={handleAddSuccess}
        onClose={() => setAddMode(null)}
      />
    </div>
  )
}
