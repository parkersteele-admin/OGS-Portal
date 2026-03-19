/**
 * src/pages/customer/OrderPage.tsx
 *
 * Customer portal — multi-item order builder
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getDocs, query, where } from 'firebase/firestore'
import { productsCol, customerTanksCol } from '../../lib/firestore'
import { useAuth } from '../../hooks/useAuth'
import { useCustomer } from '../../hooks/queries'
import {
  createBatchOrders,
  calculateOrderPricing,
} from '../../services/orderService'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import type { Product } from '../../types/product'
import type { Tank } from '../../types/tank'
import type { DeliveryTier } from '../../types/order'
import './PlaceOrder.css'

interface OrderItem {
  productId: string
  tankId: string
  quantity: number
}

interface WizardState {
  items: OrderItem[]
  tier: DeliveryTier
  scheduledDate: string
  notes: string
}

const INITIAL: WizardState = {
  items: [],
  tier: 'standard',
  scheduledDate: '',
  notes: '',
}

const DELIVERY_FEE = 35
const STEPS = ['Build your order', 'Delivery details', 'Review & confirm']

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function addDays(base: Date, days: number): string {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function fmtDateStr(s: string): string {
  if (!s) return '—'
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

function normalizeQuantity(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.floor(value))
}

function matchingTanksForProduct(product: Product, tanks: Tank[]): Tank[] {
  const productName = product.name.toLowerCase()
  return tanks.filter(
    (tank) =>
      tank.gasType.toLowerCase() === productName ||
      productName.includes(tank.gasType.toLowerCase()),
  )
}

interface SummaryLine {
  item: OrderItem
  product: Product
  subtotal: number
}

interface OrderSummaryData {
  lines: SummaryLine[]
  itemsCount: number
  unitsCount: number
  subtotal: number
  deliveryFee: number
  total: number
}

function summarizeOrder(items: OrderItem[], products: Product[], tier: DeliveryTier): OrderSummaryData {
  const lines = items
    .map((item) => {
      const product = products.find((entry) => entry.id === item.productId)
      if (!product) return null
      const pricing = calculateOrderPricing(item.quantity, product.pricePerUnit, tier, 0)
      return {
        item,
        product,
        subtotal: pricing.subtotal,
      }
    })
    .filter((line): line is SummaryLine => line !== null)

  const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0)
  const deliveryFee = lines.length > 0 ? DELIVERY_FEE : 0

  return {
    lines,
    itemsCount: lines.length,
    unitsCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal,
    deliveryFee,
    total: subtotal + deliveryFee,
  }
}

const ProgressBar: React.FC<{ step: number }> = ({ step }) => (
  <div className="po-progress" role="navigation" aria-label="Order steps">
    {STEPS.map((label, i) => (
      <React.Fragment key={label}>
        <div className={`po-progress__step ${i < step ? 'po-progress__step--done' : ''} ${i === step ? 'po-progress__step--active' : ''}`}>
          <div className="po-progress__circle">{i < step ? '✓' : i + 1}</div>
          <span className="po-progress__label">{label}</span>
        </div>
        {i < STEPS.length - 1 && (
          <div className={`po-progress__line ${i < step ? 'po-progress__line--done' : ''}`} />
        )}
      </React.Fragment>
    ))}
  </div>
)

interface QuantityControlProps {
  value: number
  unitLabel?: string
  onChange: (value: number) => void
  compact?: boolean
}

const QuantityControl: React.FC<QuantityControlProps> = ({ value, unitLabel, onChange, compact = false }) => (
  <div className={`po-stepper ${compact ? 'po-stepper--compact' : ''}`}>
    <button
      type="button"
      className="po-stepper__btn"
      aria-label="Decrease quantity"
      disabled={value <= 1}
      onClick={() => onChange(value - 1)}
    >
      −
    </button>
    <input
      type="number"
      className="po-stepper__input"
      min={1}
      value={value}
      aria-label={unitLabel ? `Quantity in ${unitLabel}` : 'Quantity'}
      onChange={(e) => {
        const nextValue = parseInt(e.target.value, 10)
        if (!Number.isNaN(nextValue)) onChange(nextValue)
      }}
    />
    <button
      type="button"
      className="po-stepper__btn"
      aria-label="Increase quantity"
      onClick={() => onChange(value + 1)}
    >
      +
    </button>
  </div>
)

const TIER_INFO: Record<DeliveryTier, { label: string; hint: string; badge: string | null; badgeVariant: 'warning' | 'danger' | null }> = {
  standard: {
    label: 'Standard',
    hint: 'Scheduled within the next 7 days',
    badge: null,
    badgeVariant: null,
  },
  'next-day': {
    label: 'Next day',
    hint: 'Delivered tomorrow',
    badge: '+10% upcharge',
    badgeVariant: 'warning',
  },
  'same-day': {
    label: 'Same day',
    hint: 'Subject to availability',
    badge: '+25% upcharge',
    badgeVariant: 'danger',
  },
}

interface OrderSummaryPanelProps {
  title: string
  summary: OrderSummaryData
  tier: DeliveryTier
  emptyLabel: string
  continueLabel?: string
  continueDisabled?: boolean
  continueLoading?: boolean
  onContinue?: () => void
  editable?: boolean
  onQuantityChange?: (productId: string, quantity: number) => void
  onRemove?: (productId: string) => void
}

const OrderSummaryPanel: React.FC<OrderSummaryPanelProps> = ({
  title,
  summary,
  tier,
  emptyLabel,
  continueLabel,
  continueDisabled,
  continueLoading = false,
  onContinue,
  editable = false,
  onQuantityChange,
  onRemove,
}) => (
  <aside className="po-summary" aria-label="Order summary">
    <div className="po-summary__inner">
      <div className="po-summary__header">
        <div>
          <p className="po-summary__eyebrow">Order summary</p>
          <h3 className="po-summary__title">{title}</h3>
        </div>
        <Badge variant="neutral">{summary.itemsCount} items</Badge>
      </div>

      {summary.lines.length === 0 ? (
        <div className="po-summary__empty">{emptyLabel}</div>
      ) : (
        <>
          <div className="po-summary__meta">
            <span>{summary.unitsCount} total units</span>
            <span>{TIER_INFO[tier].label} delivery</span>
          </div>

          <div className="po-summary__list">
            {summary.lines.map(({ item, product, subtotal }) => (
              <div key={product.id} className="po-summary__line">
                <div className="po-summary__line-top">
                  <div>
                    <p className="po-summary__line-name">{product.name}</p>
                    <p className="po-summary__line-price">{fmtCurrency(product.pricePerUnit)} / {product.unit}</p>
                  </div>
                  <div className="po-summary__line-total">{fmtCurrency(subtotal)}</div>
                </div>

                {editable && onQuantityChange ? (
                  <div className="po-summary__line-controls">
                    <QuantityControl
                      value={item.quantity}
                      unitLabel={product.unit}
                      compact
                      onChange={(quantity) => onQuantityChange(product.id, normalizeQuantity(quantity))}
                    />
                    {onRemove && (
                      <button
                        type="button"
                        className="po-summary__remove"
                        onClick={() => onRemove(product.id)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="po-summary__line-meta">Qty {item.quantity} {product.unit}</div>
                )}
              </div>
            ))}
          </div>

          <div className="po-summary__totals">
            <div className="po-summary__row">
              <span>Products</span>
              <span>{fmtCurrency(summary.subtotal)}</span>
            </div>
            <div className="po-summary__row">
              <span>Delivery</span>
              <span>{fmtCurrency(summary.deliveryFee)}</span>
            </div>
            <div className="po-summary__row po-summary__row--total">
              <span>Estimated total</span>
              <span>{fmtCurrency(summary.total)}</span>
            </div>
          </div>

          {continueLabel && onContinue && (
            <Button
              variant="primary"
              size="lg"
              className="po-summary__cta"
              disabled={continueDisabled}
              loading={continueLoading}
              onClick={onContinue}
            >
              {continueLabel}
            </Button>
          )}
        </>
      )}
    </div>
  </aside>
)

interface ProductCardProps {
  product: Product
  item?: OrderItem
  matchingTanks: Tank[]
  onToggle: (productId: string) => void
  onQuantityChange: (productId: string, quantity: number) => void
  onTankChange: (productId: string, tankId: string) => void
}

const ProductCard: React.FC<ProductCardProps> = ({
  product,
  item,
  matchingTanks,
  onToggle,
  onQuantityChange,
  onTankChange,
}) => {
  const isSelected = !!item

  return (
    <article className={`po-product-card ${isSelected ? 'po-product-card--selected' : ''}`}>
      <div className="po-product-card__top">
        <div>
          <p className="po-product-card__eyebrow">{product.category}</p>
          <h3 className="po-product-card__name">{product.name}</h3>
        </div>
        <button
          type="button"
          className={`po-product-card__action ${isSelected ? 'po-product-card__action--selected' : ''}`}
          onClick={() => onToggle(product.id)}
        >
          {isSelected ? 'Selected' : 'Add item'}
        </button>
      </div>

      {product.description && <p className="po-product-card__desc">{product.description}</p>}

      <div className="po-product-card__meta">
        <span className="po-product-card__price">{fmtCurrency(product.pricePerUnit)}</span>
        <span className="po-product-card__unit">per {product.unit}</span>
      </div>

      {isSelected && item && (
        <div className="po-product-card__builder">
          <div className="po-product-card__field">
            <span className="po-product-card__label">Quantity</span>
            <QuantityControl
              value={item.quantity}
              unitLabel={product.unit}
              onChange={(quantity) => onQuantityChange(product.id, normalizeQuantity(quantity))}
            />
          </div>

          {matchingTanks.length > 0 && (
            <div className="po-product-card__field">
              <span className="po-product-card__label">Tank association</span>
              <div className="po-tank-select__list">
                <button
                  type="button"
                  className={`po-tank-pill ${!item.tankId ? 'po-tank-pill--selected' : ''}`}
                  onClick={() => onTankChange(product.id, '')}
                >
                  No specific tank
                </button>
                {matchingTanks.map((tank) => (
                  <button
                    key={tank.id}
                    type="button"
                    className={`po-tank-pill ${item.tankId === tank.id ? 'po-tank-pill--selected' : ''}`}
                    onClick={() => onTankChange(product.id, tank.id)}
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
        </div>
      )}
    </article>
  )
}

interface TierCardProps {
  tier: DeliveryTier
  selected: boolean
  onSelect: () => void
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
        {info.badge && <Badge variant={info.badgeVariant ?? 'neutral'}>{info.badge}</Badge>}
      </div>
      <span className="po-tier-card__hint">{info.hint}</span>
    </button>
  )
}

interface Step1Props {
  products: Product[]
  tanks: Tank[]
  state: WizardState
  onToggleProduct: (productId: string) => void
  onQuantityChange: (productId: string, quantity: number) => void
  onTankChange: (productId: string, tankId: string) => void
  onNext: () => void
}

const Step1: React.FC<Step1Props> = ({
  products,
  tanks,
  state,
  onToggleProduct,
  onQuantityChange,
  onTankChange,
  onNext,
}) => {
  const summary = useMemo(() => summarizeOrder(state.items, products, state.tier), [state.items, products, state.tier])

  return (
    <section className="po-builder">
      <div className="po-builder__main">
        <div className="po-step-heading">
          <h2 className="po-step__title">Build your order</h2>
          <p className="po-step__sub">Add multiple products, set quantities, and associate tanks where needed.</p>
        </div>

        <div className="po-product-grid">
          {products.map((product) => {
            const item = state.items.find((entry) => entry.productId === product.id)
            const matchingTanks = matchingTanksForProduct(product, tanks)

            return (
              <ProductCard
                key={product.id}
                product={product}
                item={item}
                matchingTanks={matchingTanks}
                onToggle={onToggleProduct}
                onQuantityChange={onQuantityChange}
                onTankChange={onTankChange}
              />
            )
          })}
        </div>
      </div>

      <OrderSummaryPanel
        title="Current build"
        summary={summary}
        tier={state.tier}
        emptyLabel="Select at least one product to start building the order."
        continueLabel="Continue to delivery"
        continueDisabled={summary.lines.length === 0}
        onContinue={onNext}
        editable
        onQuantityChange={onQuantityChange}
        onRemove={onToggleProduct}
      />
    </section>
  )
}

interface Step2Props {
  products: Product[]
  state: WizardState
  onChange: (patch: Partial<WizardState>) => void
  onQuantityChange: (productId: string, quantity: number) => void
  onRemoveItem: (productId: string) => void
  onBack: () => void
  onNext: () => void
}

const Step2: React.FC<Step2Props> = ({
  products,
  state,
  onChange,
  onQuantityChange,
  onRemoveItem,
  onBack,
  onNext,
}) => {
  const summary = useMemo(() => summarizeOrder(state.items, products, state.tier), [state.items, products, state.tier])
  const { min: dateMin, max: dateMax } = dateConstraints(state.tier)

  const canProceed =
    summary.lines.length > 0 &&
    state.scheduledDate >= dateMin &&
    state.scheduledDate <= dateMax

  const handleTierSelect = (tier: DeliveryTier) => {
    const { min } = dateConstraints(tier)
    onChange({ tier, scheduledDate: min })
  }

  return (
    <section className="po-builder">
      <div className="po-builder__main po-builder__main--details">
        <div className="po-step-heading">
          <h2 className="po-step__title">Delivery details</h2>
          <p className="po-step__sub">Set fulfillment speed, requested date, and operational notes for the full order.</p>
        </div>

        <div className="po-section-card">
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
            <p className="po-field-hint">Available window: {fmtDateStr(dateMin)} to {fmtDateStr(dateMax)}.</p>
          </div>

          <div className="po-field-group">
            <label className="po-label" htmlFor="po-notes">Order notes <span className="po-optional">(optional)</span></label>
            <textarea
              id="po-notes"
              className="po-textarea"
              rows={4}
              placeholder="Access instructions, dock notes, site contact, special handling…"
              value={state.notes}
              onChange={(e) => onChange({ notes: e.target.value })}
            />
          </div>
        </div>

        <div className="po-nav po-nav--inline">
          <Button variant="ghost" size="md" onClick={onBack}>← Back to products</Button>
        </div>
      </div>

      <OrderSummaryPanel
        title="Ready for review"
        summary={summary}
        tier={state.tier}
        emptyLabel="Your order is empty."
        continueLabel="Review and confirm"
        continueDisabled={!canProceed}
        onContinue={onNext}
        editable
        onQuantityChange={onQuantityChange}
        onRemove={onRemoveItem}
      />
    </section>
  )
}

interface Step3Props {
  products: Product[]
  state: WizardState
  customerId: string
  tanks: Tank[]
  onBack: () => void
  onConfirm: (orderIds: string[]) => void
}

const Step3: React.FC<Step3Props> = ({ products, state, customerId, tanks, onBack, onConfirm }) => {
  const { data: customer } = useCustomer(customerId)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const summary = useMemo(() => summarizeOrder(state.items, products, state.tier), [state.items, products, state.tier])

  const handleSubmit = async () => {
    if (!customerId || summary.lines.length === 0) return

    setSubmitting(true)
    setError(null)

    try {
      const ids = await createBatchOrders(
        summary.lines.map(({ item, product }) => ({
          customerId,
          productId: product.id,
          tankId: item.tankId || undefined,
          quantity: item.quantity,
          deliveryTier: state.tier,
          notes: state.notes || undefined,
          unitPrice: product.pricePerUnit,
        })),
        DELIVERY_FEE,
      )
      onConfirm(ids)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to place order. Please try again.')
      setSubmitting(false)
    }
  }

  const deliveryAddress = customer
    ? [customer.address, customer.city, customer.state, customer.zip].filter(Boolean).join(', ')
    : 'Your delivery address'

  return (
    <section className="po-builder">
      <div className="po-builder__main po-builder__main--review">
        <div className="po-step-heading">
          <h2 className="po-step__title">Review and confirm</h2>
          <p className="po-step__sub">Validate the line items and delivery plan before submitting the order set.</p>
        </div>

        <div className="po-review-card">
          <div className="po-review-section">
            <p className="po-review-section__label">Line items</p>
            <div className="po-review-list">
              {summary.lines.map(({ item, product, subtotal }) => {
                const tank = tanks.find((entry) => entry.id === item.tankId)

                return (
                  <div key={product.id} className="po-review-list__item">
                    <div>
                      <p className="po-review-list__name">{product.name}</p>
                      <p className="po-review-list__meta">{item.quantity} {product.unit} · {fmtCurrency(product.pricePerUnit)} / {product.unit}</p>
                      {tank && <p className="po-review-list__meta">Tank {tank.serialNumber}</p>}
                    </div>
                    <div className="po-review-list__total">{fmtCurrency(subtotal)}</div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="po-review-divider" />

          <div className="po-review-row">
            <span className="po-review-label">Delivery tier</span>
            <span className="po-review-value">
              {TIER_INFO[state.tier].label}
              {TIER_INFO[state.tier].badge && (
                <Badge variant={TIER_INFO[state.tier].badgeVariant ?? 'neutral'}>{TIER_INFO[state.tier].badge}</Badge>
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
        </div>

        {error && <div className="po-error" role="alert">{error}</div>}

        <div className="po-nav po-nav--inline">
          <Button variant="ghost" size="md" onClick={onBack} disabled={submitting}>← Back to delivery</Button>
        </div>
      </div>

      <OrderSummaryPanel
        title="Submit order"
        summary={summary}
        tier={state.tier}
        emptyLabel="Your order is empty."
        continueLabel="Place order"
        continueDisabled={submitting || summary.lines.length === 0}
        continueLoading={submitting}
        onContinue={handleSubmit}
      />
    </section>
  )
}

interface SuccessProps {
  orderIds: string[]
  state: WizardState
  products: Product[]
}

const SuccessScreen: React.FC<SuccessProps> = ({ orderIds, state, products }) => {
  const navigate = useNavigate()
  const productNames = state.items
    .map((item) => products.find((product) => product.id === item.productId)?.name)
    .filter((name): name is string => !!name)

  return (
    <div className="po-success">
      <div className="po-success__icon" aria-hidden="true">✓</div>
      <h2 className="po-success__title">Order submitted</h2>
      <p className="po-success__sub">
        {orderIds.length} delivery request{orderIds.length === 1 ? '' : 's'} for {productNames.join(', ')} have been created and sent to scheduling.
      </p>

      <div className="po-success__detail">
        <div className="po-success__row">
          <span>Items</span>
          <span>{state.items.length}</span>
        </div>
        <div className="po-success__row">
          <span>Delivery tier</span>
          <span>{TIER_INFO[state.tier].label}</span>
        </div>
        <div className="po-success__row">
          <span>Requested date</span>
          <span>{fmtDateStr(state.scheduledDate)}</span>
        </div>
        <div className="po-success__row">
          <span>Order refs</span>
          <span className="po-success__id">{orderIds.map((id) => id.slice(0, 8).toUpperCase()).join(', ')}</span>
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

interface ReorderState {
  productId: string
  quantity: number
  tier: DeliveryTier
  notes: string
}

const OrderPage: React.FC = () => {
  const { user } = useAuth()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const customerId = user?.customerId ?? ''
  const preselectedProductId = searchParams.get('productId') ?? ''
  const reorder = (location.state as { reorder?: ReorderState } | null)?.reorder

  const [step, setStep] = useState(reorder ? 1 : 0)
  const [wizState, setWizState] = useState<WizardState>(
    reorder
      ? {
          items: [{ productId: reorder.productId, quantity: reorder.quantity, tankId: '' }],
          tier: reorder.tier,
          scheduledDate: '',
          notes: reorder.notes,
        }
      : preselectedProductId
        ? {
            ...INITIAL,
            items: [{ productId: preselectedProductId, quantity: 1, tankId: '' }],
          }
        : INITIAL,
  )
  const [orderIds, setOrderIds] = useState<string[] | null>(null)

  useEffect(() => {
    if (reorder && !wizState.scheduledDate) {
      const { min } = dateConstraints(reorder.tier)
      setWizState((prev) => ({ ...prev, scheduledDate: min }))
    }
  }, [reorder, wizState.scheduledDate])

  const { data: products = [], isLoading: productsLoading } = useQuery<Product[]>({
    queryKey: ['products', 'active'],
    queryFn: async () => {
      const snap = await getDocs(query(productsCol, where('active', '==', true)))
      return snap.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id } as Product))
    },
    staleTime: 10 * 60 * 1000,
  })

  const { data: tanks = [], isLoading: tanksLoading } = useQuery<Tank[]>({
    queryKey: ['customer-tanks', customerId],
    queryFn: async () => {
      const snap = await getDocs(query(customerTanksCol(customerId), where('status', '==', 'deployed')))
      return snap.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id } as Tank))
    },
    enabled: !!customerId,
    staleTime: 5 * 60 * 1000,
  })

  const patch = useCallback((nextPatch: Partial<WizardState>) => {
    setWizState((prev) => ({ ...prev, ...nextPatch }))
  }, [])

  const toggleProduct = useCallback((productId: string) => {
    setWizState((prev) => {
      const exists = prev.items.some((item) => item.productId === productId)
      return {
        ...prev,
        items: exists
          ? prev.items.filter((item) => item.productId !== productId)
          : [...prev.items, { productId, tankId: '', quantity: 1 }],
      }
    })
  }, [])

  const updateItem = useCallback((productId: string, patchItem: Partial<OrderItem>) => {
    setWizState((prev) => ({
      ...prev,
      items: prev.items.map((item) => (
        item.productId === productId
          ? {
              ...item,
              ...patchItem,
              quantity: normalizeQuantity(patchItem.quantity ?? item.quantity),
            }
          : item
      )),
    }))
  }, [])

  const handleNextFromStep1 = useCallback(() => {
    const { min } = dateConstraints(wizState.tier)
    if (!wizState.scheduledDate) patch({ scheduledDate: min })
    setStep(1)
  }, [patch, wizState.scheduledDate, wizState.tier])

  if (orderIds) {
    return (
      <div className="po-page">
        <SuccessScreen orderIds={orderIds} state={wizState} products={products} />
      </div>
    )
  }

  return (
    <div className="po-page">
      <header className="po-header">
        <h1 className="po-header__title">Build a new order</h1>
      </header>

      <ProgressBar step={step} />

      {productsLoading || tanksLoading ? (
        <div className="po-spinner" aria-label="Loading order builder" />
      ) : null}

      {!productsLoading && !tanksLoading && step === 0 && (
        <Step1
          products={products}
          tanks={tanks}
          state={wizState}
          onToggleProduct={toggleProduct}
          onQuantityChange={(productId, quantity) => updateItem(productId, { quantity })}
          onTankChange={(productId, tankId) => updateItem(productId, { tankId })}
          onNext={handleNextFromStep1}
        />
      )}

      {!productsLoading && !tanksLoading && step === 1 && (
        <Step2
          products={products}
          state={wizState}
          onChange={patch}
          onQuantityChange={(productId, quantity) => updateItem(productId, { quantity })}
          onRemoveItem={toggleProduct}
          onBack={() => setStep(0)}
          onNext={() => setStep(2)}
        />
      )}

      {!productsLoading && !tanksLoading && step === 2 && (
        <Step3
          products={products}
          state={wizState}
          customerId={customerId}
          tanks={tanks}
          onBack={() => setStep(1)}
          onConfirm={setOrderIds}
        />
      )}
    </div>
  )
}

export default OrderPage
