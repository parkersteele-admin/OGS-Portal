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
import { productsCol, customerTanksCol, ordersCol } from '../../../lib/firestore'
import { useAuth } from '../../../hooks/useAuth'
import { useCustomer } from '../../../hooks/queries'
import { usePricingAccess } from '../../../hooks/usePricingAccess'
import { useCompanySettings } from '../../../hooks/useCompanySettings'
import { useCustomerProductPricing } from '../../../hooks/useCustomerProductPricing'
import {
  createBatchOrders,
  getDeliverySettings,
  generateGroupId,
  getRouteSchedule,
  updateRouteSchedule,
  addOnToNextDelivery,
} from '../../../services/orderService'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import type { Product } from '../../../types/product'
import type { Tank } from '../../../types/tank'
import type { DeliveryTier, DeliverySettings, RouteSchedule, RouteCadence, OrderType } from '../../../types/order'
import { DEFAULT_DELIVERY_SETTINGS } from '../../../types/order'
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

// ── Order type selector ───────────────────────────────────────────────────────

interface OrderTypeSelectorProps {
  value: OrderType
  onChange: (type: OrderType) => void
}

const ORDER_TYPE_OPTIONS: { type: OrderType; label: string; sub: string }[] = [
  { type: 'offRoute',  label: 'Will-Call / One-Time', sub: 'As-needed, outside your schedule' },
  { type: 'route',     label: 'Standing Order',        sub: 'Update your recurring schedule' },
  { type: 'addOn',     label: 'Add to Next Delivery',  sub: 'A la carte items on your next stop' },
]

const OrderTypeSelector: React.FC<OrderTypeSelectorProps> = ({ value, onChange }) => (
  <div className="po-order-type-selector">
    {ORDER_TYPE_OPTIONS.map(({ type, label, sub }) => (
      <button
        key={type}
        type="button"
        className={`po-order-type-btn ${value === type ? 'po-order-type-btn--active' : ''}`}
        onClick={() => onChange(type)}
        aria-pressed={value === type}
      >
        <span className="po-order-type-btn__label">{label}</span>
        <span className="po-order-type-btn__sub">{sub}</span>
      </button>
    ))}
  </div>
)

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

function fmtDate(d: Date | null | undefined): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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
  pricingMap: Map<string, number> = new Map(),
): OrderSummaryData {
  const config = settings[tier]
  const lines = items
    .map((item) => {
      const product = products.find((p) => p.id === item.productId)
      if (!product) return null
      const basePrice = pricingMap.has(item.productId)
        ? pricingMap.get(item.productId)!
        : product.pricePerUnit
      const effectivePrice = basePrice * (1 + config.upchargePercent)
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
  orderMode: OrderType
  pricingMap?: Map<string, number>
  onOrderModeChange: (mode: OrderType) => void
  onToggleProduct: (productId: string) => void
  onQuantityChange: (productId: string, quantity: number) => void
  onTankChange: (productId: string, tankId: string) => void
  onNext: () => void
}

const CATEGORY_ORDER = ['CO₂ Cylinders', 'Nitrogen', 'Beer Gas', 'Propane', 'Rentals']

const Step1: React.FC<Step1Props> = ({
  products, tanks, state, recentProductIds, settings,
  orderMode, onOrderModeChange, pricingMap = new Map(),
  onToggleProduct, onQuantityChange, onTankChange, onNext,
}) => {
  const summary = useMemo(
    () => summarizeOrder(state.items, products, state.tier, settings, pricingMap),
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

        {/* Order type selector — always at the top of Step 1 */}
        <OrderTypeSelector value={orderMode} onChange={onOrderModeChange} />

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

interface RouteScheduleForm {
  cadence: RouteCadence
  dayOfWeek: number
  customIntervalDays: number
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const CADENCE_OPTIONS: { value: RouteCadence; label: string }[] = [
  { value: 'weekly',   label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly',  label: 'Monthly' },
  { value: 'custom',   label: 'Custom interval' },
]

interface Step2Props {
  products: Product[]
  state: WizardState
  settings: DeliverySettings
  orderMode: OrderType
  pricingMap?: Map<string, number>
  routeForm: RouteScheduleForm
  onRouteFormChange: (patch: Partial<RouteScheduleForm>) => void
  onChange: (patch: Partial<WizardState>) => void
  onQuantityChange: (productId: string, quantity: number) => void
  onRemoveItem: (productId: string) => void
  onBack: () => void
  onNext: () => void
}

const Step2: React.FC<Step2Props> = ({
  products, state, settings, orderMode, routeForm, onRouteFormChange,
  pricingMap = new Map(),
  onChange, onQuantityChange, onRemoveItem, onBack, onNext,
}) => {
  const summary = useMemo(
    () => summarizeOrder(state.items, products, state.tier, settings, pricingMap),
    [state.items, products, state.tier, settings, pricingMap],
  )
  const { min: dateMin, max: dateMax } = dateConstraints(state.tier)

  const canProceed = orderMode === 'route'
    ? summary.lines.length > 0
    : summary.lines.length > 0 &&
      state.scheduledDate >= dateMin &&
      state.scheduledDate <= dateMax

  const handleTierSelect = (tier: DeliveryTier) => {
    onChange({ tier, scheduledDate: dateConstraints(tier).min })
  }

  // ── Route cadence path ──────────────────────────────────────────────────────
  if (orderMode === 'route') {
    return (
      <section className="po-builder">
        <div className="po-builder__main po-builder__main--details">
          <div className="po-step-heading">
            <h2 className="po-step__title">Standing order schedule</h2>
            <p className="po-step__sub">Set the cadence and delivery day for your recurring order.</p>
          </div>

          <div className="po-section-card">
            <div className="po-field-group">
              <label className="po-label">Delivery cadence</label>
              <div className="po-cadence-grid">
                {CADENCE_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    className={`po-cadence-btn ${routeForm.cadence === value ? 'po-cadence-btn--active' : ''}`}
                    onClick={() => onRouteFormChange({ cadence: value })}
                    aria-pressed={routeForm.cadence === value}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {routeForm.cadence === 'custom' && (
              <div className="po-field-group">
                <label className="po-label" htmlFor="po-interval">Interval (days)</label>
                <input
                  id="po-interval"
                  type="number"
                  min={1}
                  className="po-date-input"
                  value={routeForm.customIntervalDays}
                  onChange={(e) => onRouteFormChange({ customIntervalDays: parseInt(e.target.value, 10) || 1 })}
                />
              </div>
            )}

            <div className="po-field-group">
              <label className="po-label">Preferred delivery day</label>
              <div className="po-day-grid">
                {DAY_NAMES.map((day, i) => (
                  <button
                    key={day}
                    type="button"
                    className={`po-day-btn ${routeForm.dayOfWeek === i ? 'po-day-btn--active' : ''}`}
                    onClick={() => onRouteFormChange({ dayOfWeek: i })}
                    aria-pressed={routeForm.dayOfWeek === i}
                  >
                    {day.slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>

            <div className="po-field-group">
              <label className="po-label" htmlFor="po-notes">
                Notes <span className="po-optional">(optional)</span>
              </label>
              <textarea
                id="po-notes"
                className="po-textarea"
                rows={3}
                placeholder="Any special instructions for recurring deliveries…"
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
          title="Standing order items"
          summary={summary}
          tier={state.tier}
          settings={settings}
          emptyLabel="Add at least one product."
          continueLabel="Review standing order"
          continueDisabled={!canProceed}
          onContinue={onNext}
          editable
          onQuantityChange={onQuantityChange}
          onRemove={onRemoveItem}
        />
      </section>
    )
  }

  // ── Default: will-call / off-route path ─────────────────────────────────────
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
  orderMode: OrderType
  pricingMap?: Map<string, number>
  routeForm: RouteScheduleForm
  nextRouteOrderId: string | null
  nextRouteDate: Date | null
  onBack: () => void
  onConfirm: (groupId: string) => void
}

const Step3: React.FC<Step3Props> = ({
  products, state, settings, customerId, tanks, groupId,
  orderMode, routeForm, nextRouteOrderId, nextRouteDate, pricingMap = new Map(),
  onBack, onConfirm,
}) => {
  const { user } = useAuth()
  const { data: customer } = useCustomer(customerId)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const summary = useMemo(
    () => summarizeOrder(state.items, products, state.tier, settings, pricingMap),
    [state.items, products, state.tier, settings, pricingMap],
  )
  const tierMeta = TIER_META[state.tier]
  const tierConfig = settings[state.tier]
  const upPct = tierConfig.upchargePercent

  // Compute next 3 delivery dates for standing order preview
  const nextDeliveryDates = useMemo(() => {
    if (orderMode !== 'route') return []
    const dates: Date[] = []
    const base = new Date()
    let intervalDays = 7
    if (routeForm.cadence === 'biweekly') intervalDays = 14
    else if (routeForm.cadence === 'monthly') intervalDays = 30
    else if (routeForm.cadence === 'custom') intervalDays = routeForm.customIntervalDays || 7

    // Find next occurrence of the chosen day of week
    const d = new Date(base)
    d.setDate(d.getDate() + 1) // start tomorrow
    while (d.getDay() !== routeForm.dayOfWeek) {
      d.setDate(d.getDate() + 1)
    }
    for (let i = 0; i < 3; i++) {
      dates.push(new Date(d))
      d.setDate(d.getDate() + intervalDays)
    }
    return dates
  }, [orderMode, routeForm])

  const handleSubmit = async () => {
    if (!customerId || summary.lines.length === 0) return
    setSubmitting(true)
    setError(null)
    try {
      if (orderMode === 'route') {
        // Write to routeSchedule, not /orders
        const uid = user?.id ?? customerId
        await updateRouteSchedule(
          customerId,
          {
            isActive: true,
            cadence: routeForm.cadence,
            customIntervalDays: routeForm.cadence === 'custom' ? routeForm.customIntervalDays : undefined,
            dayOfWeek: routeForm.dayOfWeek,
            lineItems: summary.lines.map(({ item, product }) => ({
              productId: product.id,
              qty: item.quantity,
              unitPrice: product.pricePerUnit,
            })),
            notes: state.notes || '',
          },
          uid,
        )
        onConfirm(groupId)
      } else if (orderMode === 'addOn') {
        // Write add-ons to the next route order
        if (!nextRouteOrderId || !user) {
          setError('No upcoming route delivery found to add items to.')
          setSubmitting(false)
          return
        }
        await addOnToNextDelivery(
          nextRouteOrderId,
          summary.lines.map(({ item, product }) => ({
            productId: product.id,
            productName: product.name,
            qty: item.quantity,
            addedBy: user.id,
          })),
          user.id,
        )
        onConfirm(groupId)
      } else {
        // Will-call / off-route — existing behavior
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
          'offRoute',
        )
        onConfirm(groupId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to place order. Please try again.')
      setSubmitting(false)
    }
  }

  const deliveryAddress = customer
    ? [customer.address, customer.city, customer.state, customer.zip].filter(Boolean).join(', ')
    : 'Your delivery address'

  // ── Standing order review ───────────────────────────────────────────────────
  if (orderMode === 'route') {
    return (
      <section className="po-builder">
        <div className="po-builder__main po-builder__main--review">
          <div className="po-step-heading">
            <h2 className="po-step__title">Review standing order</h2>
            <p className="po-step__sub">This will update your recurring schedule for future deliveries.</p>
          </div>

          <div className="po-review-card po-review-card--warning">
            <p className="po-review-warning">This will update your standing order. All future deliveries will use these items and cadence.</p>
          </div>

          <div className="po-review-card">
            <div className="po-review-section">
              <p className="po-review-section__label">Items per delivery</p>
              <div className="po-review-list">
                {summary.lines.map(({ item, product }) => (
                  <div key={product.id} className="po-review-list__item">
                    <div>
                      <p className="po-review-list__name">{product.name}</p>
                      <p className="po-review-list__meta">Qty {item.quantity} · {fmtCurrency(product.pricePerUnit)} / {product.unit}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="po-review-divider" />
            <div className="po-review-row">
              <span className="po-review-label">Cadence</span>
              <span className="po-review-value">{CADENCE_OPTIONS.find((c) => c.value === routeForm.cadence)?.label}</span>
            </div>
            <div className="po-review-row">
              <span className="po-review-label">Delivery day</span>
              <span className="po-review-value">{DAY_NAMES[routeForm.dayOfWeek]}</span>
            </div>
            <div className="po-review-row">
              <span className="po-review-label">Next 3 deliveries</span>
              <span className="po-review-value" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                {nextDeliveryDates.map((d, i) => (
                  <span key={i}>{fmtDate(d)}</span>
                ))}
              </span>
            </div>
          </div>

          {error && <div className="po-error" role="alert">{error}</div>}

          <div className="po-nav po-nav--inline">
            <Button variant="ghost" size="md" onClick={onBack} disabled={submitting}>← Back to schedule</Button>
          </div>
        </div>

        <OrderSummaryPanel
          title="Save standing order"
          summary={summary}
          tier={state.tier}
          settings={settings}
          emptyLabel="Add items to your standing order."
          continueLabel="Save standing order"
          continueDisabled={submitting || summary.lines.length === 0}
          continueLoading={submitting}
          onContinue={handleSubmit}
        />
      </section>
    )
  }

  // ── Add-on review ───────────────────────────────────────────────────────────
  if (orderMode === 'addOn') {
    return (
      <section className="po-builder">
        <div className="po-builder__main po-builder__main--review">
          <div className="po-step-heading">
            <h2 className="po-step__title">Add to next delivery</h2>
            <p className="po-step__sub">
              {nextRouteDate
                ? `These items will be added to your ${fmtDate(nextRouteDate)} delivery.`
                : 'These items will be added to your next scheduled delivery.'}
            </p>
          </div>

          <div className="po-review-card">
            <div className="po-review-section">
              <p className="po-review-section__label">Add-on items</p>
              <div className="po-review-list">
                {summary.lines.map(({ item, product }) => (
                  <div key={product.id} className="po-review-list__item">
                    <div>
                      <p className="po-review-list__name">{product.name}</p>
                      <p className="po-review-list__meta">Qty {item.quantity} {product.unit}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {!nextRouteOrderId && (
            <div className="po-error" role="alert">
              No upcoming scheduled delivery found. Place a Will-Call order instead.
            </div>
          )}
          {error && <div className="po-error" role="alert">{error}</div>}

          <div className="po-nav po-nav--inline">
            <Button variant="ghost" size="md" onClick={onBack} disabled={submitting}>← Back to products</Button>
          </div>
        </div>

        <OrderSummaryPanel
          title="Confirm add-ons"
          summary={summary}
          tier={state.tier}
          settings={settings}
          emptyLabel="Add items to attach to your delivery."
          continueLabel={nextRouteDate ? `Add to ${fmtDate(nextRouteDate)} delivery` : 'Add to delivery'}
          continueDisabled={submitting || summary.lines.length === 0 || !nextRouteOrderId}
          continueLoading={submitting}
          onContinue={handleSubmit}
        />
      </section>
    )
  }

  // ── Will-call / off-route review ────────────────────────────────────────────
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
  pricingMap?: Map<string, number>
}

const SuccessScreen: React.FC<SuccessProps> = ({ groupId, state, products, settings, pricingMap = new Map() }) => {
  const navigate = useNavigate()
  const summary = useMemo(
    () => summarizeOrder(state.items, products, state.tier, settings, pricingMap),
    [state, products, settings, pricingMap],
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
  const customerId = user?.companyId ?? user?.customerId ?? ''
  const { pricingUnlocked, isLoading: pricingLoading } = usePricingAccess()
  const company = useCompanySettings()
  const preselectedProductId = searchParams.get('productId') ?? ''
  const locationState = location.state as { reorder?: ReorderState; orderType?: OrderType; modifyThisOnly?: boolean; orderId?: string } | null
  const reorder = locationState?.reorder
  // Pre-select order mode from navigation state (e.g. from dashboard "Edit standing order")
  const preselectedMode = (locationState?.orderType ?? 'offRoute') as OrderType

  const [orderMode, setOrderMode] = useState<OrderType>(reorder ? 'offRoute' : preselectedMode)
  const [routeForm, setRouteForm] = useState<RouteScheduleForm>({
    cadence: 'weekly',
    dayOfWeek: 1,
    customIntervalDays: 14,
  })

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

  // Load existing routeSchedule to pre-fill standing order form
  const { data: routeSchedule = null } = useQuery<RouteSchedule | null>({
    queryKey: ['route-schedule', customerId],
    queryFn:  () => getRouteSchedule(customerId),
    enabled:  !!customerId,
    staleTime: 5 * 60 * 1000,
  })

  // Pre-fill routeForm from existing schedule when switching to route mode
  useEffect(() => {
    if (orderMode === 'route' && routeSchedule) {
      setRouteForm({
        cadence: routeSchedule.cadence,
        dayOfWeek: routeSchedule.dayOfWeek ?? 1,
        customIntervalDays: routeSchedule.customIntervalDays ?? 14,
      })
    }
  }, [orderMode, routeSchedule])

  // Find next upcoming route order for addOn targeting
  const { data: nextRouteOrder = null } = useQuery<{ id: string; date: Date | null } | null>({
    queryKey: ['next-route-order', customerId],
    queryFn: async () => {
      if (!customerId) return null
      const { getOrders } = await import('../../../services/orderService')
      const page = await getOrders({ customerId }, { pageSize: 50 })
      const upcoming = page.data
        .filter((o) => o.orderType === 'route' && o.status !== 'cancelled' && o.status !== 'delivered' && o.status !== 'paid')
        .sort((a, b) => {
          const da = a.scheduledAt?.toDate?.()?.getTime() ?? a.requestedAt?.toDate?.()?.getTime() ?? 0
          const db2 = b.scheduledAt?.toDate?.()?.getTime() ?? b.requestedAt?.toDate?.()?.getTime() ?? 0
          return da - db2
        })[0]
      if (!upcoming) return null
      return {
        id: upcoming.id,
        date: upcoming.scheduledAt?.toDate?.() ?? upcoming.requestedAt?.toDate?.() ?? null,
      }
    },
    enabled: !!customerId && orderMode === 'addOn',
    staleTime: 2 * 60 * 1000,
  })

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

  const { entries: customerPricingEntries } = useCustomerProductPricing(customerId)
  const customerPricingMap = new Map(
    customerPricingEntries.map((p) => [p.productId, p.price])
  )

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
    if (orderMode === 'addOn') {
      // Skip step 1 (delivery details) — go straight to review
      setStep(2)
      return
    }
    const { min } = dateConstraints(wizState.tier)
    if (!wizState.scheduledDate) patch({ scheduledDate: min })
    setStep(1)
  }, [patch, wizState.scheduledDate, wizState.tier, orderMode])

  if (confirmedGroupId) {
    return (
      <div className="po-page">
        <SuccessScreen
          groupId={confirmedGroupId}
          state={wizState}
          products={products}
          settings={deliverySettings}
          pricingMap={customerPricingMap}
        />
      </div>
    )
  }

  // Pricing gate — block until OGS sends first quote
  if (!pricingLoading && !pricingUnlocked) {
    return (
      <div className="po-page">
        <div className="po-pricing-gate">
          <div className="po-pricing-gate__icon" aria-hidden="true">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="12" cy="16" r="1.5" fill="currentColor"/>
            </svg>
          </div>
          <h2 className="po-pricing-gate__title">Ordering not yet available</h2>
          <p className="po-pricing-gate__body">
            Your account pricing hasn't been set up yet. Once our team sends you
            a quote, ordering will be unlocked automatically.
          </p>
          <p className="po-pricing-gate__body">
            Questions? Contact us at{' '}
            {company.email
              ? <a href={`mailto:${company.email}`} className="po-pricing-gate__link">{company.email}</a>
              : null
            }
            {company.email && company.phone ? ' or call ' : null}
            {company.phone
              ? <a href={`tel:${company.phone.replace(/\D/g,'')}`} className="po-pricing-gate__link">{company.phone}</a>
              : null
            }
            {!company.email && !company.phone ? 'our team.' : '.'}
          </p>
        </div>
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
          orderMode={orderMode}
          pricingMap={customerPricingMap}
          onOrderModeChange={setOrderMode}
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
          orderMode={orderMode}
          pricingMap={customerPricingMap}
          routeForm={routeForm}
          onRouteFormChange={(p) => setRouteForm((prev) => ({ ...prev, ...p }))}
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
          orderMode={orderMode}
          pricingMap={customerPricingMap}
          routeForm={routeForm}
          nextRouteOrderId={nextRouteOrder?.id ?? null}
          nextRouteDate={nextRouteOrder?.date ?? null}
          onBack={() => setStep(orderMode === 'addOn' ? 0 : 1)}
          onConfirm={setConfirmedGroupId}
        />
      )}
    </div>
  )
}

export default OrderPage
