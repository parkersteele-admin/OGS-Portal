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

// ── Stat Card ──────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  accent?: 'brand' | 'success' | 'warning' | 'danger' | 'purple' | 'neutral'
  loading?: boolean
}

function StatCard({ label, value, sub, accent = 'neutral', loading = false }: StatCardProps) {
  return (
    <div className={`adash-stat adash-stat--${accent}`}>
      <p className="adash-stat__label">{label}</p>
      {loading ? (
        <div className="adash-stat__skeleton" />
      ) : (
        <p className="adash-stat__value">{value}</p>
      )}
      {sub && !loading && <p className="adash-stat__sub">{sub}</p>}
    </div>
  )
}

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

  return (
    <div className="adash">
      {/* Header */}
      <div className="adash__header">
        <div>
          <h1 className="adash__title">Admin Dashboard</h1>
          <p className="adash__subtitle">{fmtDate(new Date())} · Oversight across CRM, Operations &amp; Admin</p>
        </div>
      </div>

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
          <StatCard
            label="Active Customers"
            value={crm.data?.activeCustomers ?? 0}
            sub={crm.data ? `${crm.data.totalCustomers} total` : undefined}
            accent="success"
            loading={crm.loading}
          />
          <StatCard
            label="Open Leads"
            value={crm.data?.openLeads ?? 0}
            sub="New / contacted / qualified"
            accent="brand"
            loading={crm.loading}
          />
          <StatCard
            label="Pending Setup"
            value={crm.data?.pendingSetup ?? 0}
            sub="Awaiting account creation"
            accent={crm.data && crm.data.pendingSetup > 0 ? 'warning' : 'neutral'}
            loading={crm.loading}
          />
          <StatCard
            label="Open Quotes"
            value={crm.data ? fmtCurrency(crm.data.openQuoteValue) : '—'}
            sub={crm.data ? `${crm.data.openQuoteCount} quote${crm.data.openQuoteCount !== 1 ? 's' : ''}` : undefined}
            accent="purple"
            loading={crm.loading}
          />
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
          <StatCard
            label="Pending Orders"
            value={ops.data?.pendingOrders ?? 0}
            sub="Awaiting dispatch"
            accent={ops.data && ops.data.pendingOrders > 0 ? 'warning' : 'neutral'}
            loading={ops.loading}
          />
          <StatCard
            label="Active Runs"
            value={ops.data?.activeRuns ?? 0}
            sub="Scheduled + in-progress"
            accent={ops.data && ops.data.activeRuns > 0 ? 'success' : 'neutral'}
            loading={ops.loading}
          />
          <StatCard
            label="Low Tanks"
            value={ops.data?.lowTanks ?? 0}
            sub="≤ 30% level deployed"
            accent={ops.data && ops.data.lowTanks > 0 ? 'danger' : 'neutral'}
            loading={ops.loading}
          />
          <StatCard
            label="Outstanding Invoices"
            value={ops.data ? fmtCurrency(ops.data.outstandingInvoiceTotal) : '—'}
            sub={ops.data ? `${ops.data.outstandingInvoiceCount} unpaid` : undefined}
            accent={ops.data && ops.data.outstandingInvoiceCount > 0 ? 'warning' : 'neutral'}
            loading={ops.loading}
          />
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
          <StatCard
            label="Total Portal Users"
            value={admin.data?.totalUsers ?? 0}
            accent="neutral"
            loading={admin.loading}
          />
          <StatCard
            label="OGS Staff"
            value={admin.data?.ogsStaff ?? 0}
            sub="Admin · Dispatch · Driver · Sales"
            accent="brand"
            loading={admin.loading}
          />
          <StatCard
            label="Customer Accounts"
            value={admin.data?.customerAccounts ?? 0}
            sub="Owner · Manager · Billing · Delivery"
            accent="success"
            loading={admin.loading}
          />
        </div>
      </Section>
    </div>
  )
}
