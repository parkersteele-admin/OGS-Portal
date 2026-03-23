/**
 * src/pages/customer/DashboardPage.tsx
 *
 * Customer portal — Account Dashboard
 *
 * Sections:
 *  • Page header     — title + "Report tank level" + "+ Place order" actions
 *  • Alert bar       — shown when any deployed tank is low (≤ 20%)
 *  • Stat cards      — Outstanding balance | Orders this year | Autopay
 *  • Two-col grid    — Active tanks card + Recent invoices card
 *  • Full-width      — Recent orders card
 *  • Mobile footer   — sticky "Report level" + "+ Place order" buttons
 */

import React, { useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import { useAuth } from '../../../hooks/useAuth'
import { useOnboarding } from '../../../hooks/useOnboarding'
import { useCustomerTanks } from '../../../hooks/useCustomerTanks'
import { usePaymentMethods } from '../../../hooks/usePaymentMethods'
import { useCustomerInvoices, useCustomerOrders } from '../../../hooks/queries'
import { getRouteSchedule } from '../../../services/orderService'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { STEP_LABELS } from '../../../components/onboarding/OnboardingStepper'
import type { Invoice, InvoiceStatus } from '../../../types/billing'
import type { Order, OrderStatus, DeliveryTier, RouteSchedule } from '../../../types/order'
import type { Tank } from '../../../types/tank'
import type { Product } from '../../../types/product'
import './Dashboard.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function toDate(ts: { toDate?: () => Date } | null | undefined): Date | null {
  return ts?.toDate?.() ?? null
}

function levelColor(pct: number): string {
  if (pct <= 20) return 'var(--color-danger)'
  if (pct <= 40) return 'var(--color-warning)'
  return 'var(--color-success)'
}

type BadgeVariant = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'

function invoiceBadgeVariant(status: InvoiceStatus): BadgeVariant {
  const map: Record<InvoiceStatus, BadgeVariant> = {
    draft:   'neutral',
    sent:    'info',
    paid:    'success',
    overdue: 'danger',
    void:    'neutral',
  }
  return map[status] ?? 'neutral'
}

function orderStatusVariant(status: OrderStatus): BadgeVariant {
  const map: Record<OrderStatus, BadgeVariant> = {
    pending:      'warning',
    scheduled:    'info',
    assigned:     'info',
    'in-transit': 'brand',
    delivered:    'success',
    invoiced:     'info',
    paid:         'success',
    cancelled:    'danger',
    archived:     'neutral',
  }
  return map[status] ?? 'neutral'
}

function tierLabel(tier: DeliveryTier, upchargePercent: number): string | null {
  if (tier === 'standard') return null
  const pct = Math.round(upchargePercent * 100)
  return tier === 'next-day' ? `+${pct}% Next Day` : `+${pct}% Same Day`
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface TankRowProps { tank: Tank }
const TankRow: React.FC<TankRowProps> = ({ tank }) => {
  const level = tank.currentLevelPct ?? 0
  return (
    <div className="cust-db__tank-row">
      <div className="cust-db__tank-info">
        <span className="cust-db__tank-name">{tank.gasType} — {tank.sizeLabel}</span>
        <span className="cust-db__tank-serial">{tank.serialNumber}</span>
      </div>
      <div className="cust-db__tank-right">
        <div className="cust-db__level-bar">
          <div
            className="cust-db__level-fill"
            style={{ width: `${level}%`, background: levelColor(level) }}
          />
        </div>
        <span className="cust-db__level-pct" style={{ color: levelColor(level) }}>
          {level}%
        </span>
        <Badge variant={tank.status === 'deployed' ? 'success' : 'neutral'}>
          {tank.status}
        </Badge>
      </div>
    </div>
  )
}

interface InvoiceRowProps { invoice: Invoice }
const InvoiceRow: React.FC<InvoiceRowProps> = ({ invoice }) => (
  <div className="cust-db__inv-row">
    <span className="cust-db__inv-number">{invoice.invoiceNumber}</span>
    <span className="cust-db__inv-date">{fmtDate(toDate(invoice.issuedAt))}</span>
    <span className="cust-db__inv-amount">{fmtCurrency(invoice.total)}</span>
    <Badge variant={invoiceBadgeVariant(invoice.status)}>{invoice.status}</Badge>
  </div>
)

interface OrderRowProps { order: Order; productName: string }
const OrderRow: React.FC<OrderRowProps> = ({ order, productName }) => {
  const label = tierLabel(order.deliveryTier, order.upchargePercent)
  return (
    <div className="cust-db__ord-row">
      <span className="cust-db__ord-product">{productName}</span>
      <span className="cust-db__ord-date">{fmtDate(toDate(order.requestedAt))}</span>
      <div className="cust-db__ord-badges">
        {label && (
          <Badge variant={order.deliveryTier === 'next-day' ? 'warning' : 'danger'}>
            {label}
          </Badge>
        )}
        <Badge variant={orderStatusVariant(order.status)}>{order.status}</Badge>
      </div>
      <span className="cust-db__ord-amount">{fmtCurrency(order.total)}</span>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const DashboardPage: React.FC = () => {
  const navigate   = useNavigate()
  const { user }   = useAuth()
  const customerId = user?.customerId ?? null

  // Onboarding state
  const { setupComplete, setupStep, companyId, loading: obLoading } = useOnboarding()
  const hasCompany          = !!companyId
  const isPendingJoinRequest = !hasCompany && !!user && !obLoading

  // Real-time subscriptions
  const { tanks, hasLowLevel } = useCustomerTanks(customerId)
  const { defaultMethod }      = usePaymentMethods(customerId ?? undefined)

  // TanStack Query
  const { data: invoicesPage } = useCustomerInvoices(customerId, 4)
  const { data: ordersPage }   = useCustomerOrders(customerId, 3)

  // Route schedule
  const { data: routeSchedule = null } = useQuery<RouteSchedule | null>({
    queryKey: ['route-schedule', customerId],
    queryFn:  () => getRouteSchedule(customerId!),
    enabled:  !!customerId,
    staleTime: 5 * 60 * 1000,
  })

  // Product lookup (cached 10 min — products rarely change)
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ['products'],
    queryFn:  async () => {
      const snap = await getDocs(collection(db, 'products'))
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Product))
    },
    staleTime: 10 * 60 * 1000,
  })

  const productMap = useMemo(
    () => Object.fromEntries(products.map((p) => [p.id, p.name])),
    [products],
  )

  const invoices = invoicesPage?.data ?? []
  const orders   = ordersPage?.data   ?? []

  // ── Stat calculations ───────────────────────────────────────────────────────
  const { outstandingTotal, pendingCount, earliestDue } = useMemo(() => {
    const pending = invoices.filter(
      (inv) => inv.status === 'sent' || inv.status === 'overdue',
    )
    const total = pending.reduce((sum, inv) => sum + inv.total, 0)
    const earliest = pending.reduce<Date | null>((min, inv) => {
      const d = toDate(inv.dueAt)
      return !min || (d && d < min) ? d : min
    }, null)
    return { outstandingTotal: total, pendingCount: pending.length, earliestDue: earliest }
  }, [invoices])

  const { ordersThisYear, lastOrderDate } = useMemo(() => {
    const year    = new Date().getFullYear()
    const thisYear = orders.filter(
      (o) => toDate(o.requestedAt)?.getFullYear() === year,
    )
    const sorted = [...orders].sort(
      (a, b) => (toDate(b.requestedAt)?.getTime() ?? 0) - (toDate(a.requestedAt)?.getTime() ?? 0),
    )
    return { ordersThisYear: thisYear.length, lastOrderDate: toDate(sorted[0]?.requestedAt) }
  }, [orders])

  // Low-level alert: pick the tank with the lowest reading
  const lowTank = hasLowLevel
    ? tanks
        .filter((t) => t.status === 'deployed' && (t.currentLevelPct ?? 100) <= 20)
        .sort((a, b) => (a.currentLevelPct ?? 0) - (b.currentLevelPct ?? 0))[0]
    : null

  const activeTanks = tanks.filter((t) => t.status === 'deployed')

  return (
    <div className="cust-db">

      {/* ── Pending join request holding screen ──────────────────────────── */}
      {isPendingJoinRequest && (
        <div className="cust-db__join-pending">
          <div className="cust-db__join-pending__icon" aria-hidden="true">⏳</div>
          <h2 className="cust-db__join-pending__title">Access request pending</h2>
          <p className="cust-db__join-pending__body">
            The account owner has been notified. You'll receive an email once your
            request is approved.
          </p>
        </div>
      )}

      {/* ── Incomplete setup banner ───────────────────────────────────────── */}
      {hasCompany && !setupComplete && !obLoading && (
        <div className="cust-db__setup-banner">
          <div className="cust-db__setup-banner__content">
            <p className="cust-db__setup-banner__msg">
              <strong>Your account setup is incomplete.</strong>&nbsp;
              Complete setup to view pricing and place orders.
            </p>
            <Link to="/portal/onboarding" className="cust-db__setup-banner__cta">
              Continue Setup →
            </Link>
          </div>
          <ol className="cust-db__setup-steps">
            {STEP_LABELS.map((label, i) => {
              const stepNum = i + 1
              const done    = stepNum <= (setupStep ?? 0)
              const next    = stepNum === (setupStep ?? 0) + 1
              return (
                <li
                  key={stepNum}
                  className={[
                    'cust-db__setup-step',
                    done ? 'cust-db__setup-step--done' : '',
                    next ? 'cust-db__setup-step--next' : '',
                  ].join(' ').trim()}
                >
                  <span className="cust-db__setup-step__num">{done ? '✓' : stepNum}</span>
                  <span className="cust-db__setup-step__label">{label}</span>
                </li>
              )
            })}
          </ol>
        </div>
      )}

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <header className="cust-db__header">
        <h1 className="cust-db__title">Dashboard</h1>
        <div className="cust-db__header-actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate('/portal/tanks')}
          >
            Report tank level
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => navigate('/portal/order')}
          >
            Place order
          </Button>
        </div>
      </header>

      {/* ── Low-level alert ────────────────────────────────────────────────── */}
      {lowTank && (
        <div className="cust-db__alert" role="alert">
          <span className="cust-db__alert-dot" aria-hidden="true" />
          <p className="cust-db__alert-text">
            CO₂ cylinder at&nbsp;
            <strong>{lowTank.currentLevelPct ?? 0}%</strong>
            &nbsp;— getting low.&nbsp;
            <button
              className="cust-db__alert-link"
              onClick={() => navigate('/portal/order')}
            >
              Order a refill
            </button>
            &nbsp;or&nbsp;
            <button
              className="cust-db__alert-link"
              onClick={() => navigate('/portal/tanks')}
            >
              update level
            </button>
            .
          </p>
        </div>
      )}

      {/* ── Overview ──────────────────────────────────────────────────────── */}
      <section className="cust-db__section">
        <div className="cust-db__section-head">
          <h2 className="cust-db__section-title">Overview</h2>
        </div>
        <div className="cust-db__stats">

        {/* Outstanding balance */}
        <div className="cust-db__stat">
          <span className="cust-db__stat-label">Outstanding balance</span>
          <span className="cust-db__stat-value">
            {fmtCurrency(outstandingTotal)}
          </span>
          <span className="cust-db__stat-sub">
            {pendingCount === 0
              ? 'No invoices due'
              : `${pendingCount} invoice${pendingCount > 1 ? 's' : ''} due ${fmtDate(earliestDue)}`}
          </span>
        </div>

        {/* Orders this year */}
        <div className="cust-db__stat">
          <span className="cust-db__stat-label">Orders this year</span>
          <span className="cust-db__stat-value">{ordersThisYear}</span>
          <span className="cust-db__stat-sub">
            {lastOrderDate ? `Last: ${fmtDate(lastOrderDate)}` : 'No orders yet'}
          </span>
        </div>

        {/* Autopay */}
        <div className="cust-db__stat">
          <span className="cust-db__stat-label">Autopay</span>
          <span className="cust-db__stat-value">
            {defaultMethod ? `•••• ${defaultMethod.last4}` : '—'}
          </span>
          <span className="cust-db__stat-sub">
            <Badge variant={defaultMethod ? 'success' : 'neutral'}>
              {defaultMethod ? 'Active' : 'Inactive'}
            </Badge>
          </span>
        </div>

        </div>
      </section>

      {/* ── Operations ─────────────────────────────────────────────────────── */}
      <section className="cust-db__section">
        <div className="cust-db__section-head">
          <h2 className="cust-db__section-title">Operations</h2>
        </div>
        <div className="cust-db__grid">

        {/* Active tanks */}
        <div className="cust-db__card">
          <div className="cust-db__card-header">
            <span className="cust-db__card-title">Active tanks</span>
            <button
              className="cust-db__card-link"
              onClick={() => navigate('/portal/tanks')}
            >
              Manage tanks
            </button>
          </div>
          <div className="cust-db__card-body">
            {activeTanks.length === 0 ? (
              <p className="cust-db__empty">No active tanks on file.</p>
            ) : (
              activeTanks.map((tank) => <TankRow key={tank.id} tank={tank} />)
            )}
          </div>
        </div>

        {/* Recent invoices */}
        <div className="cust-db__card">
          <div className="cust-db__card-header">
            <span className="cust-db__card-title">Recent invoices</span>
            <button
              className="cust-db__card-link"
              onClick={() => navigate('/portal/invoices')}
            >
              View all
            </button>
          </div>
          <div className="cust-db__card-body">
            {invoices.length === 0 ? (
              <p className="cust-db__empty">No invoices yet.</p>
            ) : (
              invoices.map((inv) => <InvoiceRow key={inv.id} invoice={inv} />)
            )}
          </div>
        </div>

        {/* Standing order */}
        <div className="cust-db__card cust-db__card--standing">
          <div className="cust-db__card-header">
            <span className="cust-db__card-title">Your Standing Order</span>
            {routeSchedule && (
              <button
                className="cust-db__card-link"
                onClick={() => navigate('/portal/order', { state: { orderType: 'route' } })}
              >
                Edit standing order
              </button>
            )}
          </div>
          <div className="cust-db__card-body">
            {!routeSchedule ? (
              <div className="cust-db__standing-empty">
                <p className="cust-db__empty">No standing order set up yet.</p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate('/portal/order', { state: { orderType: 'route' } })}
                >
                  Set up a standing order
                </Button>
              </div>
            ) : (
              <>
                <div className="cust-db__standing-meta">
                  <span className="cust-db__standing-cadence">
                    {({ weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly', custom: 'Custom' } as Record<string, string>)[routeSchedule.cadence] ?? routeSchedule.cadence}
                  </span>
                  {routeSchedule.nextDeliveryDate && (
                    <span className="cust-db__standing-next">
                      Next: {toDate(routeSchedule.nextDeliveryDate)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
                {routeSchedule.lineItems?.map((li, i) => (
                  <div key={i} className="cust-db__standing-item">
                    <span className="cust-db__standing-item-qty">{li.qty}×</span>
                    <span className="cust-db__standing-item-id">{li.productId}</span>
                  </div>
                ))}
                <div className="cust-db__standing-actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navigate('/portal/order', { state: { orderType: 'addOn' } })}
                  >
                    Add to next delivery
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>

        </div>

        {/* ── Recent orders (full width) ──────────────────────────────────── */}
        <div className="cust-db__card cust-db__card--full">
        <div className="cust-db__card-header">
          <span className="cust-db__card-title">Recent orders</span>
          <button
            className="cust-db__card-link"
            onClick={() => navigate('/portal/orders')}
          >
            View all
          </button>
        </div>
        <div className="cust-db__card-body">
          {orders.length === 0 ? (
            <p className="cust-db__empty">No orders yet.</p>
          ) : (
            <>
              <div className="cust-db__ord-header">
                <span>Product</span>
                <span>Date</span>
                <span>Tier / Status</span>
                <span className="cust-db__ord-amount-col">Amount</span>
              </div>
              {orders.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  productName={productMap[order.productId] ?? 'Delivery'}
                />
              ))}
            </>
          )}
        </div>
        </div>
      </section>

      {/* ── Mobile sticky footer ──────────────────────────────────────────── */}
      <div className="cust-db__mobile-actions" aria-hidden="true">
        <Button
          variant="secondary"
          size="sm"
          className="cust-db__mobile-btn"
          onClick={() => navigate('/portal/tanks')}
        >
          Report level
        </Button>
        <Button
          variant="primary"
          size="sm"
          className="cust-db__mobile-btn"
          onClick={() => navigate('/portal/order')}
        >
          Place order
        </Button>
      </div>

    </div>
  )
}

export default DashboardPage
