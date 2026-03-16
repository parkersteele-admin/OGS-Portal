/**
 * src/pages/customer/OrderPage.tsx
 *
 * Customer portal — Place an Order (3-step wizard)
 *
 * Step 1 — Select product
 * Step 2 — Quantity + delivery tier + date + notes
 * Step 3 — Review & confirm
 * Success — Confirmation screen
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getDocs, query, where } from 'firebase/firestore'
import { productsCol, customerTanksCol } from '../../lib/firestore'
import { useAuth } from '../../hooks/useAuth'
import { useCustomer } from '../../hooks/queries'
import {
  createOrder,
  calculateOrderPricing,
} from '../../services/orderService'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import type { Product } from '../../types/product'
import type { Tank } from '../../types/tank'
import type { DeliveryTier } from '../../types/order'
import './PlaceOrder.css'

// ── Types ─────────────────────────────────────────────────────────────────────

interface WizardState {
  productId:    string
  tankId:       string
  quantity:     number
  tier:         DeliveryTier
  scheduledDate: string   // YYYY-MM-DD
  notes:        string
}

const INITIAL: WizardState = {
  productId:    '',
  tankId:       '',
  quantity:     1,
  tier:         'standard',
  scheduledDate: '',
  notes:        '',
}

const DELIVERY_FEE = 35

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function addDays(base: Date, days: number): string {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

/** YYYY-MM-DD → "Mon, Jan 1" */
function fmtDateStr(s: string): string {
  if (!s) return '—'
  // parse as local midnight to prevent UTC offset flipping the day
  const [y, m, d] = s.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function dateConstraints(tier: DeliveryTier): { min: string; max: string } {
  const today = new Date()
  switch (tier) {
    case 'same-day':
      return { min: addDays(today, 0), max: addDays(today, 0) }
    case 'next-day':
      return { min: addDays(today, 1), max: addDays(today, 1) }
    case 'standard':
    default:
      return { min: addDays(today, 2), max: addDays(today, 9) }
  }
}

// ── Gas-type icon map (simple emoji fallbacks) ────────────────────────────────
const GAS_ICON: Record<string, string> = {
  co2:      '🧊',
  nitrogen: '💨',
  propane:  '🔥',
  argon:    '⚗️',
  helium:   '🎈',
  oxygen:   '💧',
}
function productIcon(name: string): string {
  const key = name.toLowerCase().replace(/[^a-z₂]/g, '')
  for (const [k, icon] of Object.entries(GAS_ICON)) {
    if (key.includes(k)) return icon
  }
  return '📦'
}

// ── Progress indicator ────────────────────────────────────────────────────────

const STEPS = ['Select product', 'Quantity & delivery', 'Review & confirm']

const ProgressBar: React.FC<{ step: number }> = ({ step }) => (
  <div className="po-progress" role="navigation" aria-label="Order steps">
    {STEPS.map((label, i) => (
      <React.Fragment key={label}>
        <div className={`po-progress__step ${i < step ? 'po-progress__step--done' : ''} ${i === step ? 'po-progress__step--active' : ''}`}>
          <div className="po-progress__circle">
            {i < step ? '✓' : i + 1}
          </div>
          <span className="po-progress__label">{label}</span>
        </div>
        {i < STEPS.length - 1 && (
          <div className={`po-progress__line ${i < step ? 'po-progress__line--done' : ''}`} />
        )}
      </React.Fragment>
    ))}
  </div>
)

// ══════════════════════════════════════════════════════════════════════════════
// STEP 1 — Product selector
// ══════════════════════════════════════════════════════════════════════════════

interface Step1Props {
  customerId: string
  state:      WizardState
  onChange:   (patch: Partial<WizardState>) => void
  onNext:     () => void
}

const Step1: React.FC<Step1Props> = ({ customerId, state, onChange, onNext }) => {
  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ['products', 'active'],
    queryFn:  async () => {
      const snap = await getDocs(query(productsCol, where('active', '==', true)))
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as Product))
    },
    staleTime: 10 * 60 * 1000,
  })

  const { data: tanks = [] } = useQuery<Tank[]>({
    queryKey: ['customer-tanks', customerId],
    queryFn:  async () => {
      const snap = await getDocs(
        query(customerTanksCol(customerId), where('status', '==', 'deployed')),
      )
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as Tank))
    },
    enabled: !!customerId,
    staleTime: 5 * 60 * 1000,
  })

  const selectedProduct = products.find((p) => p.id === state.productId)

  // Tanks that match the selected product's gas type
  const matchingTanks = useMemo(() => {
    if (!selectedProduct) return []
    return tanks.filter(
      (t) => t.gasType.toLowerCase() === selectedProduct.name.toLowerCase() ||
             selectedProduct.name.toLowerCase().includes(t.gasType.toLowerCase()),
    )
  }, [tanks, selectedProduct])

  return (
    <div className="po-step">
      <h2 className="po-step__title">Select a product</h2>
      <p className="po-step__sub">Choose what you need delivered.</p>

      {isLoading ? (
        <div className="po-spinner" aria-label="Loading products" />
      ) : (
        <div className="po-product-grid">
          {products.map((product) => (
            <button
              key={product.id}
              type="button"
              className={`po-product-card ${state.productId === product.id ? 'po-product-card--selected' : ''}`}
              onClick={() => onChange({ productId: product.id, tankId: '' })}
              aria-pressed={state.productId === product.id}
            >
              <span className="po-product-card__icon">{productIcon(product.name)}</span>
              <span className="po-product-card__name">{product.name}</span>
              {product.description && (
                <span className="po-product-card__desc">{product.description}</span>
              )}
              <span className="po-product-card__price">
                {fmtCurrency(product.pricePerUnit)} / {product.unit}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Tank selection — only shown when a product is selected and customer has matching tanks */}
      {selectedProduct && matchingTanks.length > 0 && (
        <div className="po-tank-select">
          <p className="po-tank-select__label">
            Associate with one of your {selectedProduct.name} tanks (optional)
          </p>
          <div className="po-tank-select__list">
            <button
              type="button"
              className={`po-tank-pill ${!state.tankId ? 'po-tank-pill--selected' : ''}`}
              onClick={() => onChange({ tankId: '' })}
            >
              No specific tank
            </button>
            {matchingTanks.map((tank) => (
              <button
                key={tank.id}
                type="button"
                className={`po-tank-pill ${state.tankId === tank.id ? 'po-tank-pill--selected' : ''}`}
                onClick={() => onChange({ tankId: tank.id })}
              >
                {tank.serialNumber}
                {tank.currentLevelPct !== undefined && (
                  <span className="po-tank-pill__level"> · {tank.currentLevelPct}%</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="po-nav">
        <span />
        <Button
          variant="primary"
          size="md"
          disabled={!state.productId}
          onClick={onNext}
        >
          Next: Quantity & delivery →
        </Button>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// STEP 2 — Quantity + delivery + date + notes
// ══════════════════════════════════════════════════════════════════════════════

interface TierCardProps {
  tier:     DeliveryTier
  selected: boolean
  onSelect: () => void
}

const TIER_INFO: Record<DeliveryTier, { label: string; hint: string; badge: string | null; badgeVariant: 'warning' | 'danger' | null; upcharge: number }> = {
  standard: {
    label:       'Standard',
    hint:        'Scheduled within the next 7 days',
    badge:       null,
    badgeVariant: null,
    upcharge:    0,
  },
  'next-day': {
    label:       'Next day',
    hint:        'Delivered tomorrow',
    badge:       '+15% upcharge',
    badgeVariant: 'warning',
    upcharge:    0.15,
  },
  'same-day': {
    label:       'Same day',
    hint:        'Subject to availability',
    badge:       '+30% upcharge',
    badgeVariant: 'danger',
    upcharge:    0.30,
  },
}

const TierCard: React.FC<TierCardProps> = ({ tier, selected, onSelect }) => {
  const info = TIER_INFO[tier]
  return (
    <button
      type="button"
      className={`po-tier-card ${selected ? 'po-tier-card--selected' : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <div className="po-tier-card__top">
        <span className="po-tier-card__label">{info.label}</span>
        {info.badge && (
          <Badge variant={info.badgeVariant ?? 'neutral'}>{info.badge}</Badge>
        )}
      </div>
      <span className="po-tier-card__hint">{info.hint}</span>
    </button>
  )
}

interface Step2Props {
  products:   Product[]
  state:      WizardState
  onChange:   (patch: Partial<WizardState>) => void
  onBack:     () => void
  onNext:     () => void
}

const Step2: React.FC<Step2Props> = ({ products, state, onChange, onBack, onNext }) => {
  const product = products.find((p) => p.id === state.productId)
  const pricing = product
    ? calculateOrderPricing(state.quantity, product.pricePerUnit, state.tier, DELIVERY_FEE)
    : null

  const { min: dateMin, max: dateMax } = dateConstraints(state.tier)

  // When tier changes, reset scheduledDate to the new min (auto-select)
  const handleTierSelect = (tier: DeliveryTier) => {
    const { min } = dateConstraints(tier)
    onChange({ tier, scheduledDate: min })
  }

  const canProceed =
    state.quantity >= 1 && state.scheduledDate >= dateMin && state.scheduledDate <= dateMax

  return (
    <div className="po-step">
      <h2 className="po-step__title">Quantity & delivery</h2>
      <p className="po-step__sub">
        Ordering: <strong>{product?.name}</strong>
      </p>

      {/* Quantity stepper */}
      <div className="po-field-group">
        <label className="po-label">Quantity ({product?.unit ?? 'units'})</label>
        <div className="po-stepper">
          <button
            type="button"
            className="po-stepper__btn"
            aria-label="Decrease quantity"
            disabled={state.quantity <= 1}
            onClick={() => onChange({ quantity: Math.max(1, state.quantity - 1) })}
          >
            −
          </button>
          <input
            type="number"
            className="po-stepper__input"
            min={1}
            value={state.quantity}
            aria-label="Quantity"
            onChange={(e) => {
              const v = parseInt(e.target.value, 10)
              if (!isNaN(v) && v >= 1) onChange({ quantity: v })
            }}
          />
          <button
            type="button"
            className="po-stepper__btn"
            aria-label="Increase quantity"
            onClick={() => onChange({ quantity: state.quantity + 1 })}
          >
            +
          </button>
        </div>
      </div>

      {/* Delivery tier */}
      <div className="po-field-group">
        <label className="po-label">Delivery tier</label>
        <div className="po-tier-grid">
          {(['standard', 'next-day', 'same-day'] as DeliveryTier[]).map((tier) => (
            <TierCard
              key={tier}
              tier={tier}
              selected={state.tier === tier}
              onSelect={() => handleTierSelect(tier)}
            />
          ))}
        </div>
      </div>

      {/* Date picker */}
      <div className="po-field-group">
        <label className="po-label" htmlFor="po-date">Requested delivery date</label>
        <input
          id="po-date"
          type="date"
          className="po-date-input"
          min={dateMin}
          max={dateMax}
          value={state.scheduledDate}
          onChange={(e) => onChange({ scheduledDate: e.target.value })}
        />
        {state.tier === 'same-day' && (
          <p className="po-field-hint">Same-day deliveries are subject to driver availability.</p>
        )}
      </div>

      {/* Notes */}
      <div className="po-field-group">
        <label className="po-label" htmlFor="po-notes">Order notes <span className="po-optional">(optional)</span></label>
        <textarea
          id="po-notes"
          className="po-textarea"
          rows={3}
          placeholder="Access instructions, tank location, special requests…"
          value={state.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </div>

      {/* Live price calculator */}
      {pricing && (
        <div className="po-price-box">
          <div className="po-price-row">
            <span>{product?.name} × {state.quantity} {product?.unit}</span>
            <span>{fmtCurrency(pricing.unitPrice * state.quantity)}</span>
          </div>
          {pricing.upchargePercent > 0 && (
            <div className="po-price-row po-price-row--upcharge">
              <span>{TIER_INFO[state.tier].label} upcharge ({Math.round(pricing.upchargePercent * 100)}%)</span>
              <span>+{fmtCurrency(pricing.subtotal - pricing.unitPrice * state.quantity)}</span>
            </div>
          )}
          <div className="po-price-row">
            <span>Delivery fee</span>
            <span>{fmtCurrency(pricing.deliveryFee)}</span>
          </div>
          <div className="po-price-row po-price-row--total">
            <span>Total</span>
            <span>{fmtCurrency(pricing.total)}</span>
          </div>
        </div>
      )}

      <div className="po-nav">
        <Button variant="ghost" size="md" onClick={onBack}>← Back</Button>
        <Button variant="primary" size="md" disabled={!canProceed} onClick={onNext}>
          Review order →
        </Button>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// STEP 3 — Review & confirm
// ══════════════════════════════════════════════════════════════════════════════

interface Step3Props {
  products:   Product[]
  state:      WizardState
  customerId: string
  onBack:     () => void
  onConfirm:  (orderId: string) => void
}

const Step3: React.FC<Step3Props> = ({ products, state, customerId, onBack, onConfirm }) => {
  const { data: customer } = useCustomer(customerId)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const product = products.find((p) => p.id === state.productId)
  const pricing = product
    ? calculateOrderPricing(state.quantity, product.pricePerUnit, state.tier, DELIVERY_FEE)
    : null

  const tierInfo = TIER_INFO[state.tier]

  const handleSubmit = async () => {
    if (!product || !customerId) return
    setSubmitting(true)
    setError(null)
    try {
      const orderId = await createOrder(
        {
          customerId,
          productId:    product.id,
          tankId:       state.tankId || undefined,
          quantity:     state.quantity,
          deliveryTier: state.tier,
          notes:        state.notes || undefined,
        },
        product.pricePerUnit,
      )
      onConfirm(orderId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to place order. Please try again.')
      setSubmitting(false)
    }
  }

  if (!product || !pricing) return null

  const deliveryAddress = customer
    ? [customer.address, customer.city, customer.state, customer.zip].filter(Boolean).join(', ')
    : 'Your delivery address'

  return (
    <div className="po-step">
      <h2 className="po-step__title">Review your order</h2>
      <p className="po-step__sub">Please confirm the details before placing.</p>

      <div className="po-review-card">
        <div className="po-review-row">
          <span className="po-review-label">Product</span>
          <span className="po-review-value">{product.name}</span>
        </div>
        <div className="po-review-row">
          <span className="po-review-label">Quantity</span>
          <span className="po-review-value">{state.quantity} {product.unit}</span>
        </div>
        <div className="po-review-row">
          <span className="po-review-label">Delivery tier</span>
          <span className="po-review-value">
            {tierInfo.label}
            {tierInfo.badge && (
              <Badge variant={tierInfo.badgeVariant ?? 'neutral'} >{tierInfo.badge}</Badge>
            )}
          </span>
        </div>
        <div className="po-review-row">
          <span className="po-review-label">Requested date</span>
          <span className="po-review-value">{fmtDateStr(state.scheduledDate)}</span>
        </div>
        <div className="po-review-row">
          <span className="po-review-label">Deliver to</span>
          <span className="po-review-value">{deliveryAddress}</span>
        </div>
        {state.notes && (
          <div className="po-review-row">
            <span className="po-review-label">Notes</span>
            <span className="po-review-value po-review-value--notes">{state.notes}</span>
          </div>
        )}

        <div className="po-review-divider" />

        {/* Price breakdown */}
        <div className="po-review-row">
          <span className="po-review-label">Product subtotal</span>
          <span className="po-review-value">{fmtCurrency(pricing.unitPrice * state.quantity)}</span>
        </div>
        {pricing.upchargePercent > 0 && (
          <div className="po-review-row">
            <span className="po-review-label">
              {tierInfo.label} upcharge ({Math.round(pricing.upchargePercent * 100)}%)
            </span>
            <span className="po-review-value">
              +{fmtCurrency(pricing.subtotal - pricing.unitPrice * state.quantity)}
            </span>
          </div>
        )}
        <div className="po-review-row">
          <span className="po-review-label">Delivery fee</span>
          <span className="po-review-value">{fmtCurrency(pricing.deliveryFee)}</span>
        </div>
        <div className="po-review-row po-review-row--total">
          <span className="po-review-label">Total</span>
          <span className="po-review-value">{fmtCurrency(pricing.total)}</span>
        </div>
      </div>

      {error && (
        <div className="po-error" role="alert">{error}</div>
      )}

      <div className="po-nav po-nav--confirm">
        <Button variant="ghost" size="md" onClick={onBack} disabled={submitting}>
          ← Edit order
        </Button>
        <Button
          variant="primary"
          size="lg"
          className="po-confirm-btn"
          loading={submitting}
          onClick={handleSubmit}
        >
          Place order
        </Button>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// SUCCESS screen
// ══════════════════════════════════════════════════════════════════════════════

interface SuccessProps {
  orderId:  string
  state:    WizardState
  products: Product[]
}

const SuccessScreen: React.FC<SuccessProps> = ({ orderId, state, products }) => {
  const navigate = useNavigate()
  const product  = products.find((p) => p.id === state.productId)
  const tierInfo = TIER_INFO[state.tier]

  return (
    <div className="po-success">
      <div className="po-success__icon" aria-hidden="true">✓</div>
      <h2 className="po-success__title">Order placed!</h2>
      <p className="po-success__sub">
        Your {product?.name} order has been received and is pending scheduling.
      </p>

      <div className="po-success__detail">
        <div className="po-success__row">
          <span>Delivery tier</span>
          <span>{tierInfo.label}</span>
        </div>
        <div className="po-success__row">
          <span>Requested date</span>
          <span>{fmtDateStr(state.scheduledDate)}</span>
        </div>
        <div className="po-success__row">
          <span>Order ref</span>
          <span className="po-success__id">{orderId.slice(0, 8).toUpperCase()}</span>
        </div>
      </div>

      <div className="po-success__actions">
        <Button variant="secondary" size="md" onClick={() => navigate('/portal/dashboard')}>
          Back to dashboard
        </Button>
        <Button variant="primary" size="md" onClick={() => navigate('/portal/orders')}>
          View my orders
        </Button>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// ROOT — wizard controller
// ══════════════════════════════════════════════════════════════════════════════

interface ReorderState {
  productId: string
  quantity:  number
  tier:      DeliveryTier
  notes:     string
}

const OrderPage: React.FC = () => {
  const { user }   = useAuth()
  const location   = useLocation()
  const customerId = user?.customerId ?? ''

  // Check if navigated here via Reorder button from order history
  const reorder = (location.state as { reorder?: ReorderState } | null)?.reorder

  const [step, setStep]         = useState(reorder ? 1 : 0)
  const [wizState, setWizState] = useState<WizardState>(
    reorder
      ? { ...INITIAL, productId: reorder.productId, quantity: reorder.quantity, tier: reorder.tier, notes: reorder.notes }
      : INITIAL,
  )
  const [orderId, setOrderId]   = useState<string | null>(null)

  // Pre-fill scheduled date when reordering
  useEffect(() => {
    if (reorder && !wizState.scheduledDate) {
      const { min } = dateConstraints(reorder.tier)
      setWizState((prev) => ({ ...prev, scheduledDate: min }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Product list shared between step 1, 2, 3 to avoid duplicate fetches
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ['products', 'active'],
    queryFn:  async () => {
      const snap = await getDocs(query(productsCol, where('active', '==', true)))
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as Product))
    },
    staleTime: 10 * 60 * 1000,
  })

  const patch = useCallback(
    (p: Partial<WizardState>) => setWizState((prev) => ({ ...prev, ...p })),
    [],
  )

  if (orderId) {
    return (
      <div className="po-page">
        <SuccessScreen orderId={orderId} state={wizState} products={products} />
      </div>
    )
  }

  return (
    <div className="po-page">
      <header className="po-header">
        <h1 className="po-header__title">Place an order</h1>
      </header>

      <ProgressBar step={step} />

      {step === 0 && (
        <Step1
          customerId={customerId}
          state={wizState}
          onChange={patch}
          onNext={() => {
            // Pre-fill the date when moving to step 2
            const { min } = dateConstraints(wizState.tier)
            if (!wizState.scheduledDate) patch({ scheduledDate: min })
            setStep(1)
          }}
        />
      )}

      {step === 1 && (
        <Step2
          products={products}
          state={wizState}
          onChange={patch}
          onBack={() => setStep(0)}
          onNext={() => setStep(2)}
        />
      )}

      {step === 2 && (
        <Step3
          products={products}
          state={wizState}
          customerId={customerId}
          onBack={() => setStep(1)}
          onConfirm={(id) => setOrderId(id)}
        />
      )}
    </div>
  )
}

export default OrderPage
