/**
 * src/pages/customer/OrderPage.tsx
 *
 * Customer portal — multi-item order builder
 * Step 0: Build your order (list view, recently ordered, no Fees)
 * Step 1: Delivery details (tier + date + notes)
 * Step 2: Review & confirm → single grouped order ID
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getDocs, query, where, orderBy, limit } from 'firebase/firestore'
import { productsCol, customerTanksCol, ordersCol } from '../../lib/firestore'
import { useAuth } from '../../hooks/useAuth'
import { useCustomer } from '../../hooks/queries'
import {
  createBatchOrders,
  getDeliverySettings,
  generateGroupId,
} from '../../services/orderService'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import type { Product } from '../../types/product'
import type { Tank } from '../../types/tank'
import type { DeliveryTier, DeliverySettings } from '../../types/order'
import { DEFAULT_DELIVERY_SETTINGS } from '../../types/order'
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

function summarizeOrder(
  items: OrderItem[],
  products: Product[],
  tier: DeliveryTier,
  settings: DeliverySettings,
): OrderSummaryData {
  const config = settings[tier]
  const lines = items
    .map((item) => {
      const product = products.find((p) => p.id === item.productId)
      if (!product) return null
      const effectivePrice = product.pricePerUnit * (1 + config.upchargePercent)
      const subtotal = parseFloat((effectivePrice * item.quantity).toFixed(2))
      return { item, product, subtotal }
    })
    .filter((line): line is SummaryLine => line !== null)

  const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0)
  const deliveryFee = lines.length > 0 ? config.deliveryFee : 0

  return {
    lines,
    itemsCount: lines.length,
    unitsCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal,
    deliveryFee,
    total: parseFloat((subtotal + deliveryFee).toFixed(2)),
  }
}

// ── Progress bar ──────────────────────────────────────────────────────────────

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

// ── Quantity control ──────────────────────────────────────────────────────────

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

// ── Tier meta & cards ─────────────────────────────────────────────────────────

const TIER_META: Record<DeliveryTier, { label: string; hint: string }> = {
  standard:   { label: 'Standard', hint: 'Scheduled within the next 7 days' },
  'next-day': { label: 'Next day', hint: 'Delivered tomorrow' },
  'same-day': { label: 'Same day', hint: 'Subject to availability' },
}

interface TierCardProps {
  tier: DeliveryTier
  settings: DeliverySettings
  selected: boolean
  onSelect: () => void
}

const TierCard: React.FC<TierCardProps> = ({ tier, settings, selected, onSelect }) => {
  const meta = TIER_META[tier]
  const config = settings[tier]
  const upPct = config.upchargePercent

  return (
    <button
      type="button"
      className={`po-tier-card ${selected ? 'po-tier-card--selected' : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <div className="po-tier-card__top">
        <span className="po-tier-card__label">{meta.label}</span>
        {upPct > 0 && <Badge variant="warning">+{(upPct * 100).toFixed(0)}%</Badge>}
      </div>
      <span className="po-tier-card__hint">{meta.hint}</span>
      <span className="po-tier-card__fee">{fmtCurrency(config.deliveryFee)} delivery fee</span>
    </button>
  )
}

// ── Order summary panel ───────────────────────────────────────────────────────

interface OrderSummaryPanelProps {
  title: string
  summary: OrderSummaryData
  tier: DeliveryTier
  settings: DeliverySettings
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
  title, summary, tier, settings, emptyLabel,
  continueLabel, continueDisabled, continueLoading = false,
  onContinue, editable = false, onQuantityChange, onRemove,
}) => {
  const config = settings[tier]
  const upPct = config.upchargePercent

  return (
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
              <span>{TIER_META[tier].label} delivery</span>
            </div>
            {upPct > 0 && (
              <div className="po-summary__upcharge-note">
                +{(upPct * 100).toFixed(0)}% {TIER_META[tier].label.toLowerCase()} upcharge applied
              </div>
            )}
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
                        <button type="button" className="po-summary__remove" onClick={() => onRemove(product.id)}>
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
                <span>Products</span><span>{fmtCurrency(summary.subtotal)}</span>
              </div>
              <div className="po-summary__row">
                <span>Delivery</span><span>{fmtCurrency(summary.deliveryFee)}</span>
              </div>
              <div className="po-summary__row po-summary__row--total">
                <span>Estimated total</span><span>{fmtCurrency(summary.total)}</span>
              </div>
            </div>
            {continueLabel && onContinue && (
              <Button
                variant="primary" size="lg" className="po-summary__cta"
                disabled={continueDisabled} loading={continueLoading} onClick={onContinue}
              >
                {continueLabel}
              </Button>
            )}
          </>
        )}
      </div>
    </aside>
  )
}

// ── Product list row ──────────────────────────────────────────────────────────

interface ProductListRowProps {
  product: Product
  item?: OrderItem
  matchingTanks: Tank[]
  isRecent?: boolean
  onToggle: (productId: string) => void
  onQuantityChange: (productId: string, quantity: number) => void
  onTankChange: (productId: string, tankId: string) => void
}

const ProductListRow: React.FC<ProductListRowProps> = ({
  product, item, matchingTanks, isRecent = false,
  onToggle, onQuantityChange, onTankChange,
}) => {
  const isAdded = !!item

  return (
    <div className={`po-list-row ${isAdded ? 'po-list-row--added' : ''}`}>
      <div className="po-list-row__info">
        <div className="po-list-row__name">
          {product.name}
          {product.isFeatured && <span className="po-list-row__badge po-list-row__badge--popular">Popular</span>}
          {isRecent && !isAdded && <span className="po-list-row__badge po-list-row__badge--recent">Recent</span>}
        </div>
        {(product.sku || product.sizeLabel || product.description) && (
          <div className="po-list-row__meta">
            {[product.sku, product.sizeLabel, product.description].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>

      <div className="po-list-row__price">
        <span className="po-list-row__price-val">{fmtCurrency(product.pricePerUnit)}</span>
        <span className="po-list-row__price-unit">/ {product.unit}</span>
        {product.rentalPrice != null && product.rentalPrice > 0 && (
          <span className="po-list-row__price-rental">+{fmtCurrency(product.rentalPrice)}/mo</span>
        )}
      </div>

      {isAdded && item && (
        <div className="po-list-row__qty">
          <QuantityControl
            value={item.quantity}
            unitLabel={product.unit}
            compact
            onChange={(q) => onQuantityChange(product.id, normalizeQuantity(q))}
          />
        </div>
      )}

      <div className="po-list-row__action">
        <button
          type="button"
          className={`po-list-row__btn ${isAdded ? 'po-list-row__btn--added' : ''}`}
          onClick={() => onToggle(product.id)}
        >
          {isAdded ? '✓ Added' : 'Add item'}
        </button>
        {isAdded && (
          <button type="button" className="po-list-row__remove" onClick={() => onToggle(product.id)}>
            Remove
          </button>
        )}
      </div>

      {isAdded && item && matchingTanks.length > 0 && (
        <div className="po-list-row__tanks">
          <span className="po-list-row__tanks-label">Tank:</span>
          <div className="po-tank-select__list">
            <button
              type="button"
              className={`po-tank-pill ${!item.tankId ? 'po-tank-pill--selected' : ''}`}
              onClick={() => onTankChange(product.id, '')}
            >
              Any tank
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
  )
}

// ── Step 1: Build order ───────────────────────────────────────────────────────

interface Step1Props {
  products: Product[]
  tanks: Tank[]
  state: WizardState
  recentProductIds: string[]
  settings: DeliverySettings
  onToggleProduct: (productId: string) => void
  onQuantityChange: (productId: string, quantity: number) => void
  onTankChange: (productId: string, tankId: string) => void
  onNext: () => void
}

const CATEGORY_ORDER = ['CO₂ Cylinders', 'Nitrogen', 'Beer Gas', 'Propane', 'Rentals']

const Step1: React.FC<Step1Props> = ({
  products, tanks, state, recentProductIds, settings,
  onToggleProduct, onQuantityChange, onTankChange, onNext,
}) => {
  const summary = useMemo(
    () => summarizeOrder(state.items, products, state.tier, settings),
    [state.items, products, state.tier, settings],
  )
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  // Fees category hidden — admin/sales add those directly
  const visibleProducts = useMemo(() => products.filter((p) => p.category !== 'Fees'), [products])

  const recentProducts = useMemo(() => {
    const seen = new Set<string>()
    return recentProductIds
      .map((id) => visibleProducts.find((p) => p.id === id))
      .filter((p): p is Product => !!p && !seen.has(p.id) && (seen.add(p.id), true))
      .slice(0, 6)
  }, [recentProductIds, visibleProducts])

  const grouped = useMemo(() => {
    const result: Record<string, Product[]> = {}
    for (const cat of CATEGORY_ORDER) {
      const rows = visibleProducts.filter((p) => p.category === cat)
      if (rows.length) result[cat] = rows
    }
    const extraCats = [...new Set(visibleProducts.map((p) => p.category))].filter((c) => !CATEGORY_ORDER.includes(c))
    for (const cat of extraCats) result[cat] = visibleProducts.filter((p) => p.category === cat)
    return result
  }, [visibleProducts])

  const toggleCategory = useCallback((cat: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(cat) ? next.delete(cat) : next.add(cat)
      return next
    })
  }, [])

  function renderRow(product: Product, forceRecent = false) {
    const item = state.items.find((i) => i.productId === product.id)
    return (
      <ProductListRow
        key={product.id}
        product={product}
        item={item}
        matchingTanks={matchingTanksForProduct(product, tanks)}
        isRecent={forceRecent}
        onToggle={onToggleProduct}
        onQuantityChange={onQuantityChange}
        onTankChange={onTankChange}
      />
    )
  }

  return (
    <section className="po-builder">
      <div className="po-builder__main">
        <div className="po-step-heading">
          <h2 className="po-step__title">Build your order</h2>
          <p className="po-step__sub">Add products, set quantities, and associate tanks where needed.</p>
        </div>

        <div className="po-product-list">
          {recentProducts.length > 0 && (
            <div className="po-list-section">
              <div className="po-list-section__header">
                <span className="po-list-section__title">Recently ordered</span>
                <span className="po-list-section__badge">Quick add</span>
              </div>
              <div className="po-list-section__rows">
                {recentProducts.map((p) => renderRow(p, true))}
              </div>
            </div>
          )}

          {Object.entries(grouped).map(([cat, rows]) => (
            <div key={cat} className="po-list-section">
              <button
                type="button"
                className="po-list-section__header po-list-section__header--toggle"
                onClick={() => toggleCategory(cat)}
                aria-expanded={!collapsed.has(cat)}
              >
                <span className="po-list-section__title">{cat}</span>
                <div className="po-list-section__right">
                  <span className="po-list-section__count">{rows.length} item{rows.length !== 1 ? 's' : ''}</span>
                  <span className="po-list-section__chevron">{collapsed.has(cat) ? '▸' : '▾'}</span>
                </div>
              </button>
              {!collapsed.has(cat) && (
                <div className="po-list-section__rows">
                  {rows.map((p) => renderRow(p))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <OrderSummaryPanel
        title="Current build"
        summary={summary}
        tier={state.tier}
        settings={settings}
        emptyLabel="Add at least one product to start building the order."
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

// ── Step 2: Delivery details ──────────────────────────────────────────────────

interface Step2Props {
  products: Product[]
  state: WizardState
  settings: DeliverySettings
  onChange: (patch: Partial<WizardState>) => void
  onQuantityChange: (productId: string, quantity: number) => void
  onRemoveItem: (productId: string) => void
  onBack: () => void
  onNext: () => void
}

const Step2: React.FC<Step2Props> = ({
  products, state, settings, onChange, onQuantityChange, onRemoveItem, onBack, onNext,
}) => {
  const summary = useMemo(
    () => summarizeOrder(state.items, products, state.tier, settings),
    [state.items, products, state.tier, settings],
  )
  const { min: dateMin, max: dateMax } = dateConstraints(state.tier)

  const canProceed =
    summary.lines.length > 0 &&
    state.scheduledDate >= dateMin &&
    state.scheduledDate <= dateMax

  const handleTierSelect = (tier: DeliveryTier) => {
    onChange({ tier, scheduledDate: dateConstraints(tier).min })
  }

  return (
    <section className="po-builder">
      <div className="po-builder__main po-builder__main--details">
        <div className="po-step-heading">
          <h2 className="po-step__title">Delivery details</h2>
          <p className="po-step__sub">Set fulfillment speed, requested date, and any notes for this order.</p>
        </div>

        <div className="po-section-card">
          <div className="po-field-group">
            <label className="po-label">Delivery tier</label>
            <div className="po-tier-grid">
              {(['standard', 'next-day', 'same-day'] as DeliveryTier[]).map((tier) => (
                <TierCard
                  key={tier}
                  tier={tier}
                  settings={settings}
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
            <label className="po-label" htmlFor="po-notes">
              Order notes <span className="po-optional">(optional)</span>
            </label>
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
        settings={settings}
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

// ── Step 3: Review & confirm ──────────────────────────────────────────────────

interface Step3Props {
  products: Product[]
  state: WizardState
  settings: DeliverySettings
  customerId: string
  tanks: Tank[]
  groupId: string
  onBack: () => void
  onConfirm: (groupId: string) => void
}

const Step3: React.FC<Step3Props> = ({ products, state, settings, customerId, tanks, groupId, onBack, onConfirm }) => {
  const { data: customer } = useCustomer(customerId)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const summary = useMemo(
    () => summarizeOrder(state.items, products, state.tier, settings),
    [state.items, products, state.tier, settings],
  )
  const tierMeta = TIER_META[state.tier]
  const tierConfig = settings[state.tier]
  const upPct = tierConfig.upchargePercent

  const handleSubmit = async () => {
    if (!customerId || summary.lines.length === 0) return
    setSubmitting(true)
    setError(null)
    try {
      await createBatchOrders(
        summary.lines.map(({ item, product }) => ({
          customerId,
          productId: product.id,
          tankId: item.tankId || undefined,
          quantity: item.quantity,
          deliveryTier: state.tier,
          notes: state.notes || undefined,
          unitPrice: product.pricePerUnit,
        })),
        tierConfig.deliveryFee,
        groupId,
      )
      onConfirm(groupId)
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
          <p className="po-step__sub">Check the line items and delivery plan before submitting.</p>
        </div>

        <div className="po-review-card">
          <div className="po-review-section">
            <p className="po-review-section__label">Line items</p>
            <div className="po-review-list">
              {summary.lines.map(({ item, product, subtotal }) => {
                const tank = tanks.find((t) => t.id === item.tankId)
                return (
                  <div key={product.id} className="po-review-list__item">
                    <div>
                      <p className="po-review-list__name">{product.name}</p>
                      <p className="po-review-list__meta">
                        {item.quantity} {product.unit} · {fmtCurrency(product.pricePerUnit)}/{product.unit}
                        {upPct > 0 && ` (+${(upPct * 100).toFixed(0)}%)`}
                      </p>
                      {product.sku && <p className="po-review-list__meta">SKU: {product.sku}</p>}
                      {tank && <p className="po-review-list__meta">Tank: {tank.serialNumber}</p>}
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
              {tierMeta.label}
              {upPct > 0 && <Badge variant="warning">+{(upPct * 100).toFixed(0)}%</Badge>}
            </span>
          </div>
          <div className="po-review-row">
            <span className="po-review-label">Delivery fee</span>
            <span className="po-review-value">{fmtCurrency(tierConfig.deliveryFee)}</span>
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
          <div className="po-review-row">
            <span className="po-review-label">Order ref</span>
            <span className="po-review-value po-review-value--ref">{groupId}</span>
          </div>
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
        settings={settings}
        emptyLabel="Your order is empty."
        continueLabel="Place order"
        continueDisabled={submitting || summary.lines.length === 0}
        continueLoading={submitting}
        onContinue={handleSubmit}
      />
    </section>
  )
}

// ── Success screen ────────────────────────────────────────────────────────────

interface SuccessProps {
  groupId: string
  state: WizardState
  products: Product[]
  settings: DeliverySettings
}

const SuccessScreen: React.FC<SuccessProps> = ({ groupId, state, products, settings }) => {
  const navigate = useNavigate()
  const summary = useMemo(
    () => summarizeOrder(state.items, products, state.tier, settings),
    [state, products, settings],
  )

  return (
    <div className="po-success">
      <div className="po-success__icon" aria-hidden="true">✓</div>
      <h2 className="po-success__title">Order submitted</h2>
      <p className="po-success__sub">
        {summary.itemsCount} product{summary.itemsCount !== 1 ? 's' : ''} queued for scheduling.
      </p>

      <div className="po-success__detail">
        <div className="po-success__row">
          <span>Order reference</span>
          <span className="po-success__id">{groupId}</span>
        </div>
        <div className="po-success__row">
          <span>Items</span>
          <span>{summary.itemsCount}</span>
        </div>
        <div className="po-success__row">
          <span>Delivery tier</span>
          <span>{TIER_META[state.tier].label}</span>
        </div>
        <div className="po-success__row">
          <span>Requested date</span>
          <span>{fmtDateStr(state.scheduledDate)}</span>
        </div>
        <div className="po-success__row po-success__row--total">
          <span>Estimated total</span>
          <span>{fmtCurrency(summary.total)}</span>
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

// ── Main OrderPage ────────────────────────────────────────────────────────────

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
        ? { ...INITIAL, items: [{ productId: preselectedProductId, quantity: 1, tankId: '' }] }
        : INITIAL,
  )
  const [confirmedGroupId, setConfirmedGroupId] = useState<string | null>(null)
  const [groupId] = useState(() => generateGroupId())
  const [deliverySettings, setDeliverySettings] = useState<DeliverySettings>(DEFAULT_DELIVERY_SETTINGS)

  // Scroll to top on step change (mobile: no missing content after advancing)
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [step])

  // Load admin-configurable delivery settings
  useEffect(() => {
    getDeliverySettings().then(setDeliverySettings).catch(() => { /* silently use defaults */ })
  }, [])

  // Default scheduled date for reorders
  useEffect(() => {
    if (reorder && !wizState.scheduledDate) {
      const { min } = dateConstraints(reorder.tier)
      setWizState((prev) => ({ ...prev, scheduledDate: min }))
    }
  }, [reorder, wizState.scheduledDate])

  const { data: products = [], isLoading: productsLoading } = useQuery<Product[]>({
    queryKey: ['products', 'visible'],
    queryFn: async () => {
      const snap = await getDocs(
        query(productsCol, where('active', '==', true), where('isVisible', '==', true)),
      )
      const items = snap.docs.map((d) => ({ ...d.data(), id: d.id } as Product))
      return items.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name))
    },
    staleTime: 10 * 60 * 1000,
  })

  const { data: tanks = [], isLoading: tanksLoading } = useQuery<Tank[]>({
    queryKey: ['customer-tanks', customerId],
    queryFn: async () => {
      const snap = await getDocs(query(customerTanksCol(customerId), where('status', '==', 'deployed')))
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as Tank))
    },
    enabled: !!customerId,
    staleTime: 5 * 60 * 1000,
  })

  const { data: recentProductIds = [] } = useQuery<string[]>({
    queryKey: ['recent-product-ids', customerId],
    queryFn: async () => {
      const snap = await getDocs(
        query(ordersCol, where('customerId', '==', customerId), orderBy('requestedAt', 'desc'), limit(20)),
      )
      const seen = new Set<string>()
      const ids: string[] = []
      for (const d of snap.docs) {
        const pid = (d.data() as { productId?: string }).productId
        if (pid && !seen.has(pid)) { seen.add(pid); ids.push(pid) }
      }
      return ids
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
      items: prev.items.map((item) =>
        item.productId === productId
          ? { ...item, ...patchItem, quantity: normalizeQuantity(patchItem.quantity ?? item.quantity) }
          : item,
      ),
    }))
  }, [])

  const handleNextFromStep1 = useCallback(() => {
    const { min } = dateConstraints(wizState.tier)
    if (!wizState.scheduledDate) patch({ scheduledDate: min })
    setStep(1)
  }, [patch, wizState.scheduledDate, wizState.tier])

  if (confirmedGroupId) {
    return (
      <div className="po-page">
        <SuccessScreen
          groupId={confirmedGroupId}
          state={wizState}
          products={products}
          settings={deliverySettings}
        />
      </div>
    )
  }

  return (
    <div className="po-page">
      <header className="po-header">
        <h1 className="po-header__title">Build a new order</h1>
      </header>

      <ProgressBar step={step} />

      {(productsLoading || tanksLoading) && (
        <div className="po-spinner" aria-label="Loading order builder" />
      )}

      {!productsLoading && !tanksLoading && step === 0 && (
        <Step1
          products={products}
          tanks={tanks}
          state={wizState}
          recentProductIds={recentProductIds}
          settings={deliverySettings}
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
          settings={deliverySettings}
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
          settings={deliverySettings}
          customerId={customerId}
          tanks={tanks}
          groupId={groupId}
          onBack={() => setStep(1)}
          onConfirm={setConfirmedGroupId}
        />
      )}
    </div>
  )
}

export default OrderPage
