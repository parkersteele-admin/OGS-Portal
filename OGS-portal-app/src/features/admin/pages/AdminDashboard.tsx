/**
 * AdminDashboard.tsx
 * BEM prefix: adash-
 *
 * Route: /admin/dashboard
 *
 * Three oversight sections:
 *  1. CRM — customers, leads, quotes
 *  2. Operations — orders, runs, invoices, tanks
 *  3. Admin — user counts by role group
 */

import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  onSnapshot,
  query,
  where,
  getDocs,
} from 'firebase/firestore'
import {
  customersCol,
  usersCol,
  ordersCol,
  runsCol,
  invoicesCol,
  tanksCol,
  leadsCol,
  quotesCol,
} from '../../../lib/firestore'
import type { Customer } from '../../../types/customer'
import type { AppUser } from '../../../types/user'
import type { Invoice } from '../../../types/billing'
import type { Tank } from '../../../types/tank'
import type { Lead } from '../../../types/models'
import type { Quote } from '../../../types/models'
import { StatCard } from '../../../components/ui/StatCard'
import type { Order } from '../../../types/order'
import { Card } from '../../../components/ui/Card'
import { Badge } from '../../../components/ui/Badge'
import './AdminDashboard.css'

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(n)
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })
}

// ── Types ──────────────────────────────────────────────────────────────────

interface CrmMetrics {
  totalCustomers: number
  activeCustomers: number
  openLeads: number
  pendingSetup: number
  openQuoteValue: number
  openQuoteCount: number
}

interface OpsMetrics {
  pendingOrders: number
  activeRuns: number
  lowTanks: number
  outstandingInvoiceCount: number
  outstandingInvoiceTotal: number
}

interface AdminMetrics {
  totalUsers: number
  ogsStaff: number       // admin + dispatch + driver + sales
  customerAccounts: number  // owner + manager + billing + delivery + viewer + customer
}

type PerformanceStatus = 'pending' | 'scheduled' | 'delivered' | 'invoice_sent' | 'paid' | 'cancelled'

interface RevenuePoint {
  label: string
  value: number
}

interface StatusSlice {
  status: PerformanceStatus
  label: string
  count: number
  color: string
}

interface PipelineSlice {
  label: string
  count: number
  value: number
}

interface PerformanceMetrics {
  revenueOverTime: RevenuePoint[]
  ordersByStatus: StatusSlice[]
  openPipeline: PipelineSlice[]
}

const PERFORMANCE_STATUS_META: Record<PerformanceStatus, { label: string; color: string }> = {
  pending: { label: 'Pending', color: '#FF6B1A' },
  scheduled: { label: 'Scheduled', color: '#3b82f6' },
  delivered: { label: 'Delivered', color: '#22c55e' },
  invoice_sent: { label: 'Invoice Sent', color: '#a855f7' },
  paid: { label: 'Paid', color: '#10b981' },
  cancelled: { label: 'Cancelled', color: '#9ca3af' },
}

const PERFORMANCE_STATUS_ORDER: PerformanceStatus[] = [
  'pending',
  'scheduled',
  'delivered',
  'invoice_sent',
  'paid',
  'cancelled',
]

const OPEN_QUOTE_STATUS_ORDER: Quote['status'][] = ['draft', 'sent']

// ── Hooks ──────────────────────────────────────────────────────────────────

function useCrmMetrics(): { data: CrmMetrics | null; loading: boolean } {
  const [data, setData] = useState<CrmMetrics | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let resolved = 0
    const metrics: CrmMetrics = {
      totalCustomers: 0,
      activeCustomers: 0,
      openLeads: 0,
      pendingSetup: 0,
      openQuoteValue: 0,
      openQuoteCount: 0,
    }
    const maybeFinish = () => {
      resolved++
      if (resolved === 3) {
        setData({ ...metrics })
        setLoading(false)
      }
    }

    // Customers
    const unsubCustomers = onSnapshot(customersCol, (snap) => {
      metrics.totalCustomers = snap.size
      metrics.activeCustomers = snap.docs.filter((d) => {
        const c = d.data() as Customer
        return c.status === 'active'
      }).length
      maybeFinish()
    })

    // Leads
    const unsubLeads = onSnapshot(leadsCol, (snap) => {
      const OPEN_STATUSES = ['new', 'contacted', 'qualified', 'proposal', 'new_signup']
      metrics.openLeads = snap.docs.filter((d) => {
        const l = d.data() as Lead
        return OPEN_STATUSES.includes(l.status)
      }).length
      metrics.pendingSetup = snap.docs.filter((d) => {
        const l = d.data() as Lead
        return l.status === 'pending_setup'
      }).length
      maybeFinish()
    })

    // Quotes
    const unsubQuotes = onSnapshot(
      query(quotesCol, where('status', 'in', ['draft', 'sent'])),
      (snap) => {
        metrics.openQuoteCount = snap.size
        metrics.openQuoteValue = snap.docs.reduce((s, d) => {
          const q = d.data() as Quote
          return s + (q.total ?? 0)
        }, 0)
        maybeFinish()
      },
    )

    return () => {
      unsubCustomers()
      unsubLeads()
      unsubQuotes()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { data, loading }
}

function useOpsMetrics(): { data: OpsMetrics | null; loading: boolean } {
  const [data, setData] = useState<OpsMetrics | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let resolved = 0
    const metrics: OpsMetrics = {
      pendingOrders: 0,
      activeRuns: 0,
      lowTanks: 0,
      outstandingInvoiceCount: 0,
      outstandingInvoiceTotal: 0,
    }
    const maybeFinish = () => {
      resolved++
      if (resolved === 4) {
        setData({ ...metrics })
        setLoading(false)
      }
    }

    const unsubOrders = onSnapshot(
      query(ordersCol, where('status', '==', 'pending')),
      (snap) => { metrics.pendingOrders = snap.size; maybeFinish() },
    )

    const unsubRuns = onSnapshot(
      query(runsCol, where('status', 'in', ['scheduled', 'in-progress'])),
      (snap) => { metrics.activeRuns = snap.size; maybeFinish() },
    )

    const unsubInvoices = onSnapshot(
      query(invoicesCol, where('status', 'in', ['sent', 'overdue'])),
      (snap) => {
        metrics.outstandingInvoiceCount = snap.size
        metrics.outstandingInvoiceTotal = snap.docs.reduce((s, d) => {
          const inv = d.data() as Invoice
          return s + (inv.total ?? 0)
        }, 0)
        maybeFinish()
      },
    )

    const unsubTanks = onSnapshot(
      query(tanksCol, where('status', '==', 'deployed')),
      (snap) => {
        metrics.lowTanks = snap.docs.filter((d) => {
          const t = d.data() as Tank
          return (t.currentLevelPct ?? 100) <= 30
        }).length
        maybeFinish()
      },
    )

    return () => {
      unsubOrders()
      unsubRuns()
      unsubInvoices()
      unsubTanks()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { data, loading }
}

function useAdminMetrics(): { data: AdminMetrics | null; loading: boolean } {
  const [data, setData] = useState<AdminMetrics | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getDocs(usersCol).then((snap) => {
      const OGS_ROLES = new Set(['admin', 'dispatch', 'driver', 'sales'])
      let ogsStaff = 0
      let customerAccounts = 0

      snap.docs.forEach((d) => {
        const u = d.data() as AppUser
        if (OGS_ROLES.has(u.role)) ogsStaff++
        else customerAccounts++
      })

      setData({ totalUsers: snap.size, ogsStaff, customerAccounts })
      setLoading(false)
    })
  }, [])

  return { data, loading }
}

function toDateSafe(value: unknown): Date | null {
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return ((value as { toDate: () => Date }).toDate())
  }
  if (value instanceof Date) return value
  return null
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function getOrderDate(order: Order): Date | null {
  return (
    toDateSafe(order.deliveredAt) ??
    toDateSafe(order.createdAt)
  )
}

function getOrderRevenue(order: Order): number {
  if (typeof order.paidAmount === 'number') return order.paidAmount
  if (typeof order.invoiceAmount === 'number') return order.invoiceAmount
  if (typeof order.total === 'number') return order.total
  if (typeof order.quoteTotal === 'number') return order.quoteTotal
  return 0
}

function normalizePerformanceStatus(status: Order['status']): PerformanceStatus | null {
  if (status === 'ready_to_invoice' || status === 'invoice_sent_pending') return 'invoice_sent'
  if (PERFORMANCE_STATUS_ORDER.includes(status as PerformanceStatus)) return status as PerformanceStatus
  return null
}

function usePerformanceMetrics(): { data: PerformanceMetrics | null; loading: boolean } {
  const [data, setData] = useState<PerformanceMetrics | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let orders: Order[] = []
    let quotes: Quote[] = []

    const recompute = () => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const start = new Date(today)
      start.setDate(today.getDate() - 29)

      const dayKeys: string[] = []
      const revenueByDay: Record<string, number> = {}
      const statusCounts: Record<PerformanceStatus, number> = {
        pending: 0,
        scheduled: 0,
        delivered: 0,
        invoice_sent: 0,
        paid: 0,
        cancelled: 0,
      }

      const openPipelineMap = new Map<Quote['status'], PipelineSlice>(
        OPEN_QUOTE_STATUS_ORDER.map((status) => [
          status,
          {
            label: status === 'draft' ? 'Draft' : 'Sent',
            count: 0,
            value: 0,
          },
        ]),
      )

      for (let i = 0; i < 30; i += 1) {
        const day = new Date(start)
        day.setDate(start.getDate() + i)
        const key = dateKey(day)
        dayKeys.push(key)
        revenueByDay[key] = 0
      }

      orders.forEach((order) => {

        const bucket = normalizePerformanceStatus(order.status)
        if (bucket) statusCounts[bucket] += 1

        const orderDate = getOrderDate(order)
        if (!orderDate) return

        const day = new Date(orderDate)
        day.setHours(0, 0, 0, 0)
        if (day < start || day > today) return

        const key = dateKey(day)
        if (key in revenueByDay) {
          revenueByDay[key] += getOrderRevenue(order)
        }
      })

      quotes.forEach((quote) => {
        if (!OPEN_QUOTE_STATUS_ORDER.includes(quote.status)) return
        const bucket = openPipelineMap.get(quote.status)
        if (!bucket) return
        bucket.count += 1
        bucket.value += quote.total ?? 0
      })

      const revenueOverTime = dayKeys.map((key) => {
        const [year, month, day] = key.split('-').map(Number)
        const date = new Date(year, month - 1, day)
        return {
          label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          value: Math.round((revenueByDay[key] + Number.EPSILON) * 100) / 100,
        }
      })

      const ordersByStatus = PERFORMANCE_STATUS_ORDER.map((status) => ({
        status,
        label: PERFORMANCE_STATUS_META[status].label,
        count: statusCounts[status],
        color: PERFORMANCE_STATUS_META[status].color,
      }))

      const openPipeline = OPEN_QUOTE_STATUS_ORDER
        .map((status) => openPipelineMap.get(status))
        .filter((entry): entry is PipelineSlice => Boolean(entry))

      setData({ revenueOverTime, ordersByStatus, openPipeline })
      setLoading(false)
    }

    const unsubOrders = onSnapshot(ordersCol, (snap) => {
      orders = snap.docs.map((doc) => doc.data() as Order)
      recompute()
    })

    const unsubQuotes = onSnapshot(quotesCol, (snap) => {
      quotes = snap.docs.map((doc) => doc.data() as Quote)
      recompute()
    })

    return () => {
      unsubOrders()
      unsubQuotes()
    }
  }, [])

  return { data, loading }
}

// ── Stat Card ──────────────────────────────────────────────────────────────

// ── Section ────────────────────────────────────────────────────────────────

interface SectionProps {
  title: string
  subtitle?: string
  children: React.ReactNode
  links?: Array<{ to: string; label: string }>
}

function Section({ title, subtitle, children, links }: SectionProps) {
  return (
    <section className="adash-section">
      <div className="adash-section__head">
        <div>
          <h2 className="adash-section__title">{title}</h2>
          {subtitle && <p className="adash-section__subtitle">{subtitle}</p>}
        </div>
        {links && (
          <div className="adash-section__links">
            {links.map((l) => (
              <Link key={l.to} to={l.to} className="adash-section__link">
                {l.label} →
              </Link>
            ))}
          </div>
        )}
      </div>
      <div className="adash-section__body">{children}</div>
    </section>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const crm   = useCrmMetrics()
  const ops   = useOpsMetrics()
  const admin = useAdminMetrics()
  const performance = usePerformanceMetrics()

  return (
    <div className="adash">
      <header className="page-header">
        <div className="page-header__hero">
          <div className="page-header__title-section">
            <p className="page-header__eyebrow">Revenue Operations</p>
            <h1 className="page-header__title">Admin Dashboard</h1>
            <p className="page-header__description">{fmtDate(new Date())} · Oversight across CRM, Operations &amp; Admin</p>
          </div>
          <div className="page-header__actions">
            <span className="page-header__meta-tag">Admin</span>
          </div>
        </div>
      </header>

      {/* CRM Overview */}
      <Section
        title="CRM"
        subtitle="Customers, leads, and quotes"
        links={[
          { to: '/admin/crm/customers', label: 'Customers' },
          { to: '/admin/crm/leads', label: 'Leads' },
          { to: '/admin/crm/quotes', label: 'Quotes' },
        ]}
      >
        <div className="adash-grid adash-grid--4">
          <StatCard label="Active Customers" value={crm.loading ? '—' : (crm.data?.activeCustomers ?? 0)} subLabel={crm.data ? `${crm.data.totalCustomers} total` : undefined} accent />
          <StatCard label="Open Leads" value={crm.loading ? '—' : (crm.data?.openLeads ?? 0)} subLabel="New / contacted / qualified" accent />
          <StatCard label="Pending Setup" value={crm.loading ? '—' : (crm.data?.pendingSetup ?? 0)} subLabel="Awaiting account creation" accent />
          <StatCard label="Open Quotes" value={crm.loading ? '—' : (crm.data ? fmtCurrency(crm.data.openQuoteValue) : '—')} subLabel={crm.data ? `${crm.data.openQuoteCount} quote${crm.data.openQuoteCount !== 1 ? 's' : ''}` : undefined} accent />
        </div>
      </Section>

      {/* Operations Overview */}
      <Section
        title="Operations"
        subtitle="Orders, runs, invoices, and tank levels"
        links={[
          { to: '/admin/ops/orders', label: 'Orders' },
          { to: '/admin/ops/dispatch', label: 'Dispatch' },
          { to: '/admin/ops/tanks', label: 'Tanks' },
          { to: '/admin/ops/billing', label: 'Revenue' },
        ]}
      >
        <div className="adash-grid adash-grid--4">
          <StatCard label="Pending Orders" value={ops.loading ? '—' : (ops.data?.pendingOrders ?? 0)} subLabel="Awaiting dispatch" accent />
          <StatCard label="Active Runs" value={ops.loading ? '—' : (ops.data?.activeRuns ?? 0)} subLabel="Scheduled + in-progress" accent />
          <StatCard label="Low Tanks" value={ops.loading ? '—' : (ops.data?.lowTanks ?? 0)} subLabel="≤ 30% level deployed" accent />
          <StatCard label="Outstanding Invoices" value={ops.loading ? '—' : (ops.data ? fmtCurrency(ops.data.outstandingInvoiceTotal) : '—')} subLabel={ops.data ? `${ops.data.outstandingInvoiceCount} unpaid` : undefined} accent />
        </div>
      </Section>

      {/* Admin Overview */}
      <Section
        title="Admin"
        subtitle="Portal users and settings"
        links={[
          { to: '/admin/users', label: 'User Management' },
          { to: '/admin/delivery-settings', label: 'Delivery Settings' },
        ]}
      >
        <div className="adash-grid adash-grid--3">
          <StatCard label="Total Portal Users" value={admin.loading ? '—' : (admin.data?.totalUsers ?? 0)} accent />
          <StatCard label="OGS Staff" value={admin.loading ? '—' : (admin.data?.ogsStaff ?? 0)} subLabel="Admin · Dispatch · Driver · Sales" accent />
          <StatCard label="Customer Accounts" value={admin.loading ? '—' : (admin.data?.customerAccounts ?? 0)} subLabel="Owner · Manager · Billing · Delivery" accent />
        </div>
      </Section>

      <Section
        title="PERFORMANCE"
        subtitle="Last 30 days revenue, order status mix, and open quotes"
      >
        <div className="adash-performance-grid">
          <Card className="adash-chart-card">
            <div className="adash-chart-card__head">
              <div>
                <p className="adash-chart-card__eyebrow">Trend</p>
                <h3 className="adash-chart-card__title">Revenue over time</h3>
              </div>
              <Badge variant="neutral">Orders</Badge>
            </div>
            <LineChart data={performance.data?.revenueOverTime ?? []} money />
          </Card>

          <Card className="adash-chart-card">
            <div className="adash-chart-card__head">
              <div>
                <p className="adash-chart-card__eyebrow">Conversion</p>
                <h3 className="adash-chart-card__title">Orders by status</h3>
              </div>
              <Badge variant="neutral">Current lifecycle mix</Badge>
            </div>
            <OrdersByStatusBars data={performance.data?.ordersByStatus ?? []} loading={performance.loading} />
          </Card>

          <Card className="adash-chart-card">
            <div className="adash-chart-card__head">
              <div>
                <p className="adash-chart-card__eyebrow">Pipeline</p>
                <h3 className="adash-chart-card__title">Open pipeline</h3>
              </div>
              <Badge variant="neutral">Open quotes</Badge>
            </div>
            <PipelineBars data={performance.data?.openPipeline ?? []} loading={performance.loading} />
          </Card>
        </div>
      </Section>
    </div>
  )
}

function LineChart({ data, money = false }: { data: Array<{ label: string; value: number }>; money?: boolean }) {
  const width = 720
  const height = 220
  const padding = 24
  const maxValue = Math.max(...data.map((point) => point.value), 1)
  const step = data.length > 1 ? (width - padding * 2) / (data.length - 1) : 0
  const points = data.map((point, index) => {
    const x = padding + index * step
    const y = height - padding - (point.value / maxValue) * (height - padding * 2)
    return { x, y, ...point }
  })
  const line = points.map((point) => `${point.x},${point.y}`).join(' ')
  const area = `${padding},${height - padding} ${line} ${width - padding},${height - padding}`

  if (data.length === 0) {
    return <p className="adash-chart__empty">No revenue data available for the selected period.</p>
  }

  return (
    <div className="adash-linechart">
      <svg viewBox={`0 0 ${width} ${height}`} className="adash-linechart__svg" role="img" aria-label="Revenue over time chart">
        <defs>
          <linearGradient id="adashRevenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255, 107, 26, 0.26)" />
            <stop offset="100%" stopColor="rgba(255, 107, 26, 0)" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padding + ratio * (height - padding * 2)
          return <line key={ratio} x1={padding} x2={width - padding} y1={y} y2={y} className="adash-linechart__grid" />
        })}
        <polygon points={area} fill="url(#adashRevenue)" />
        <polyline points={line} className="adash-linechart__stroke" />
        {points.map((point) => (
          <circle key={`${point.label}-${point.value}`} cx={point.x} cy={point.y} r="4" className="adash-linechart__point" />
        ))}
      </svg>
      <div className="adash-linechart__labels">
        {data.map((point) => (
          <div key={point.label} className="adash-linechart__labelgroup">
            <span>{point.label}</span>
            <strong>{money ? fmtCurrency(point.value) : point.value}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

function OrdersByStatusBars({ data, loading }: { data: StatusSlice[]; loading: boolean }) {
  if (loading) {
    return <p className="adash-chart__empty">Loading performance data…</p>
  }

  if (data.length === 0) {
    return <p className="adash-chart__empty">No order statuses available.</p>
  }

  const maxValue = Math.max(...data.map((entry) => entry.count), 1)

  return (
    <div className="adash-compare">
      <div className="adash-compare__legend">
        {data.map((entry) => (
          <span key={entry.status}><i className="adash-compare__swatch" style={{ backgroundColor: entry.color }} />{entry.label}</span>
        ))}
      </div>
      <div className="adash-compare__bars">
        {data.map((entry) => (
          <div key={entry.status} className="adash-compare__group">
            <div className="adash-compare__track">
              <span
                className="adash-compare__bar"
                style={{ height: `${(entry.count / maxValue) * 100}%`, backgroundColor: entry.color }}
              />
            </div>
            <div className="adash-compare__meta">
              <strong>{entry.label}</strong>
              <span>{entry.count}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PipelineBars({ data, loading }: { data: PipelineSlice[]; loading: boolean }) {
  if (loading) {
    return <p className="adash-chart__empty">Loading performance data…</p>
  }

  return (
    <div className="adash-pipeline">
      {data.length === 0 && <p className="adash-chart__empty">No open quotes matched the current filters.</p>}
      {data.map((entry) => (
        <div key={entry.label} className="adash-pipeline__row">
          <div className="adash-pipeline__copy">
            <strong>{entry.label}</strong>
            <span>{entry.count} quotes</span>
          </div>
          <div className="adash-pipeline__track">
            <span
              className="adash-pipeline__fill"
              style={{ width: `${(entry.value / Math.max(...data.map((item) => item.value), 1)) * 100}%` }}
            />
          </div>
          <strong className="adash-pipeline__value">{fmtCurrency(entry.value)}</strong>
        </div>
      ))}
    </div>
  )
}
