/**
 * src/pages/billing/BillingDashboard.tsx
 *
 * Staff billing dashboard accessible at /ops/billing and /crm/billing.
 *
 * Sections:
 *  1. Summary stat cards  — revenue this month, outstanding, overdue, avg days to pay
 *  2. Invoice list        — filter bar (status / date / customer) + table with actions
 *  3. Aging report        — 4 colored clickable cards that filter the invoice list
 *  4. Export              — date range + button for invoices CSV + payments CSV
 *  5. Credit holds        — accounts on hold with outstandng balance
 */

import React, { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getDocs,
  query,
  orderBy,
  where,
  Timestamp,
} from 'firebase/firestore'
import { invoicesCol, paymentsCol, customersCol } from '../../lib/firestore'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import {
  markInvoicePaid,
  markInvoiceSent,
  voidInvoice,
  generateInvoicePdf,
} from '../../services/invoiceService'
import { exportInvoicesToCsv, exportPaymentsToCsv } from '../../utils/exportUtils'
import { generateAgingReport } from '../../utils/reportUtils'
import { formatCurrency, formatDate } from '../../utils/format'
import type { Invoice, InvoiceStatus, Payment } from '../../types/billing'
import type { Customer } from '../../types/customer'
import './BillingDashboard.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function defaultExportRange() {
  const today = new Date()
  const first = new Date(today.getFullYear(), today.getMonth(), 1)
  return { start: isoDate(first), end: isoDate(today) }
}

const DAY_MS = 86_400_000

// ── Firestore fetch helpers ───────────────────────────────────────────────────

async function fetchAllInvoices(): Promise<Invoice[]> {
  const snap = await getDocs(query(invoicesCol, orderBy('issuedAt', 'desc')))
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Invoice)
}

async function fetchAllCustomers(): Promise<Customer[]> {
  const snap = await getDocs(query(customersCol, orderBy('name')))
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Customer)
}

async function fetchPaymentsInRange(start: Date, end: Date): Promise<Payment[]> {
  const snap = await getDocs(
    query(
      paymentsCol,
      where('processedAt', '>=', Timestamp.fromDate(start)),
      where('processedAt', '<=', Timestamp.fromDate(end)),
      orderBy('processedAt', 'desc'),
    ),
  )
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Payment)
}

// ── Status badge ──────────────────────────────────────────────────────────────

const InvoiceStatusBadge: React.FC<{ invoice: Invoice }> = ({ invoice }) => {
  // eslint-disable-next-line react-hooks/purity
  const now     = Date.now()
  const dueDate = invoice.dueAt?.toDate?.()

  if (invoice.status === 'paid')  return <Badge variant="success">Paid</Badge>
  if (invoice.status === 'void')  return <Badge variant="neutral">Void</Badge>
  if (invoice.status === 'draft') return <Badge variant="neutral">Draft</Badge>

  if (dueDate) {
    const daysLeft = Math.floor((dueDate.getTime() - now) / DAY_MS)
    if (daysLeft < 0)  return <Badge variant="danger">Overdue {Math.abs(daysLeft)}d</Badge>
    if (daysLeft < 7)  return <Badge variant="warning">Due in {daysLeft}d</Badge>
  }

  return <Badge variant="info">Sent</Badge>
}

// ── Stat card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label:   string
  value:   string
  sub?:    string
  danger?: boolean
}

const StatCard: React.FC<StatCardProps> = ({ label, value, sub, danger }) => (
  <Card className={`bd-stat${danger ? ' bd-stat--danger' : ''}`}>
    <p className="bd-stat__label">{label}</p>
    <p className="bd-stat__value">{value}</p>
    {sub && <p className="bd-stat__sub">{sub}</p>}
  </Card>
)

// ── Aging card ────────────────────────────────────────────────────────────────

const AGING_ACCENTS = ['base', 'base', 'base', 'base'] as const

interface AgingCardProps {
  label:       string
  total:       number
  count:       number
  accentIndex: number
  active:      boolean
  onClick:     () => void
}

const AgingCard: React.FC<AgingCardProps> = ({
  label, total, count, accentIndex, active, onClick,
}) => (
  <button
    type="button"
    className={`bd-aging-card bd-aging-card--${AGING_ACCENTS[accentIndex]}${active ? ' bd-aging-card--active' : ''}`}
    onClick={onClick}
  >
    <p className="bd-aging-card__label">{label}</p>
    <p className="bd-aging-card__amount">{formatCurrency(total)}</p>
    <p className="bd-aging-card__count">{count} invoice{count !== 1 ? 's' : ''}</p>
  </button>
)

// ── Invoice detail modal ──────────────────────────────────────────────────────

interface InvoiceDetailModalProps {
  invoice:     Invoice | null
  customerMap: Map<string, Customer>
  onClose:     () => void
}

const InvoiceDetailModal: React.FC<InvoiceDetailModalProps> = ({
  invoice, customerMap, onClose,
}) => {
  if (!invoice) return null
  const customer = customerMap.get(invoice.customerId)

  return (
    <Modal open={!!invoice} onClose={onClose} title={`Invoice ${invoice.invoiceNumber}`} size="lg">
      <div className="bd-inv-detail">
        <div className="bd-inv-detail__meta">
          <div className="bd-inv-detail__meta-item">
            <span className="bd-inv-detail__meta-label">Customer</span>
            <span className="bd-inv-detail__meta-value">{customer?.name ?? invoice.customerId}</span>
          </div>
          <div className="bd-inv-detail__meta-item">
            <span className="bd-inv-detail__meta-label">Issued</span>
            <span className="bd-inv-detail__meta-value">{formatDate(invoice.issuedAt)}</span>
          </div>
          <div className="bd-inv-detail__meta-item">
            <span className="bd-inv-detail__meta-label">Due</span>
            <span className="bd-inv-detail__meta-value">{formatDate(invoice.dueAt)}</span>
          </div>
          <div className="bd-inv-detail__meta-item">
            <span className="bd-inv-detail__meta-label">Status</span>
            <span className="bd-inv-detail__meta-value">
              <InvoiceStatusBadge invoice={invoice} />
            </span>
          </div>
          {invoice.orderId && (
            <div className="bd-inv-detail__meta-item">
              <span className="bd-inv-detail__meta-label">Order</span>
              <span className="bd-inv-detail__meta-value">{invoice.orderId}</span>
            </div>
          )}
          {invoice.paidAt && (
            <div className="bd-inv-detail__meta-item">
              <span className="bd-inv-detail__meta-label">Paid</span>
              <span className="bd-inv-detail__meta-value">{formatDate(invoice.paidAt)}</span>
            </div>
          )}
        </div>

        <table className="bd-inv-detail__table">
          <thead>
            <tr>
              <th>Description</th>
              <th className="bd-inv-detail__num">Qty</th>
              <th className="bd-inv-detail__num">Unit Price</th>
              <th className="bd-inv-detail__num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lineItems.map((item, i) => (
              <tr key={i}>
                <td>{item.description}</td>
                <td className="bd-inv-detail__num">{item.quantity}</td>
                <td className="bd-inv-detail__num">{formatCurrency(item.unitPrice)}</td>
                <td className="bd-inv-detail__num">{formatCurrency(item.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>Subtotal</td>
              <td className="bd-inv-detail__num">{formatCurrency(invoice.subtotal)}</td>
            </tr>
            {invoice.tax > 0 && (
              <tr>
                <td colSpan={3}>Tax</td>
                <td className="bd-inv-detail__num">{formatCurrency(invoice.tax)}</td>
              </tr>
            )}
            <tr className="bd-inv-detail__total-row">
              <td colSpan={3}><strong>Total</strong></td>
              <td className="bd-inv-detail__num"><strong>{formatCurrency(invoice.total)}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Modal>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export const BillingDashboard: React.FC = () => {
  const queryClient = useQueryClient()
  const exportDef   = defaultExportRange()

  // ── Filter state ────────────────────────────────────────────────────────
  const [filterStatus,    setFilterStatus]    = useState<InvoiceStatus | 'all'>('all')
  const [filterDateStart, setFilterDateStart] = useState('')
  const [filterDateEnd,   setFilterDateEnd]   = useState('')
  const [filterCustomer,  setFilterCustomer]  = useState('')
  const [agingFilter,     setAgingFilter]     = useState<number | null>(null)

  // ── Modal / action state ─────────────────────────────────────────────────
  const [viewInvoice, setViewInvoice] = useState<Invoice | null>(null)
  const [voidTarget,  setVoidTarget]  = useState<Invoice | null>(null)
  const [pdfLoading,  setPdfLoading]  = useState<string | null>(null)

  // ── Export state ─────────────────────────────────────────────────────────
  const [exportStart,  setExportStart]  = useState(exportDef.start)
  const [exportEnd,    setExportEnd]    = useState(exportDef.end)
  const [exportingInv, setExportingInv] = useState(false)
  const [exportingPay, setExportingPay] = useState(false)

  // ── Queries ──────────────────────────────────────────────────────────────
  const invoicesQuery = useQuery({
    queryKey: ['billing', 'allInvoices'],
    queryFn:  fetchAllInvoices,
    staleTime: 2 * 60 * 1000,
  })

  const customersQuery = useQuery({
    queryKey: ['billing', 'allCustomers'],
    queryFn:  fetchAllCustomers,
    staleTime: 5 * 60 * 1000,
  })

  const invoices  = invoicesQuery.data  ?? []
  const customers = customersQuery.data ?? []
  const isLoading = invoicesQuery.isPending || customersQuery.isPending

  const customerMap = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers],
  )

  // ── Mutations ────────────────────────────────────────────────────────────
  const paidMutation = useMutation({
    mutationFn: (id: string) => markInvoicePaid(id),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['billing'] }),
  })

  const sentMutation = useMutation({
    mutationFn: (id: string) => markInvoiceSent(id),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['billing'] }),
  })

  const voidMutation = useMutation({
    mutationFn: (id: string) => voidInvoice(id),
    onSuccess:  () => {
      queryClient.invalidateQueries({ queryKey: ['billing'] })
      setVoidTarget(null)
    },
  })

  // ── Summary stats (this month) ───────────────────────────────────────────
  const stats = useMemo(() => {
    const now        = Date.now()
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    const monthStartMs = monthStart.getTime()

    let revenueThisMonth = 0
    let outstanding      = 0
    let overdue          = 0
    let paidDaysTotal    = 0
    let paidCount        = 0

    for (const inv of invoices) {
      if (inv.status === 'paid') {
        const paidMs = inv.paidAt?.toDate?.().getTime() ?? 0
        if (paidMs >= monthStartMs) revenueThisMonth += inv.total
        if (inv.paidAt && inv.issuedAt) {
          const days = (inv.paidAt.toDate().getTime() - inv.issuedAt.toDate().getTime()) / DAY_MS
          if (days >= 0) { paidDaysTotal += days; paidCount++ }
        }
      } else if (inv.status !== 'void') {
        outstanding += inv.total
        const dueMs = inv.dueAt?.toDate?.().getTime() ?? Infinity
        if (dueMs < now) overdue += inv.total
      }
    }

    return {
      revenueThisMonth: parseFloat(revenueThisMonth.toFixed(2)),
      outstanding:      parseFloat(outstanding.toFixed(2)),
      overdue:          parseFloat(overdue.toFixed(2)),
      avgDaysToPay:     paidCount ? Math.round(paidDaysTotal / paidCount) : 0,
    }
  }, [invoices])

  // ── Aging buckets (4 cards) ──────────────────────────────────────────────
  const agingBuckets = useMemo(() => {
    const raw = generateAgingReport(invoices) // 5 buckets; merge 61-90 + 90+
    return [
      { label: 'Current',     count: raw[0].count,                 total: raw[0].total },
      { label: '1–30 Days',   count: raw[1].count,                 total: raw[1].total },
      { label: '31–60 Days',  count: raw[2].count,                 total: raw[2].total },
      {
        label: '61–90+ Days',
        count: raw[3].count + raw[4].count,
        total: parseFloat((raw[3].total + raw[4].total).toFixed(2)),
      },
    ]
  }, [invoices])

  // ── Filtered invoice list (client-side) ──────────────────────────────────
  const filteredInvoices = useMemo(() => {
    const now = Date.now()
    return invoices.filter((inv) => {
      if (filterStatus !== 'all' && inv.status !== filterStatus) return false

      const issuedMs = inv.issuedAt?.toDate?.().getTime() ?? 0
      if (filterDateStart) {
        if (issuedMs < new Date(filterDateStart + 'T00:00:00').getTime()) return false
      }
      if (filterDateEnd) {
        if (issuedMs > new Date(filterDateEnd + 'T23:59:59').getTime()) return false
      }

      if (filterCustomer) {
        const cust = customerMap.get(inv.customerId)
        if (!cust?.name.toLowerCase().includes(filterCustomer.toLowerCase())) return false
      }

      if (agingFilter !== null) {
        if (inv.status === 'paid' || inv.status === 'void') return false
        const dueMs = inv.dueAt?.toDate?.().getTime()
        if (!dueMs) return false
        const daysOverdue = Math.floor((now - dueMs) / DAY_MS)
        if (agingFilter === 0 && daysOverdue > 0)                        return false // Current
        if (agingFilter === 1 && (daysOverdue < 1  || daysOverdue > 30)) return false
        if (agingFilter === 2 && (daysOverdue < 31 || daysOverdue > 60)) return false
        if (agingFilter === 3 && daysOverdue < 61)                       return false // 61-90+
      }

      return true
    })
  }, [invoices, filterStatus, filterDateStart, filterDateEnd, filterCustomer, agingFilter, customerMap])

  // ── Credit holds ─────────────────────────────────────────────────────────
  const holdAccounts = useMemo(() =>
    customers
      .filter((c) => c.status === 'hold')
      .map((c) => {
        const balance = invoices
          .filter((i) => i.customerId === c.id && i.status !== 'paid' && i.status !== 'void')
          .reduce((sum, i) => sum + i.total, 0)
        return { customer: c, balance: parseFloat(balance.toFixed(2)) }
      }),
    [customers, invoices],
  )

  // ── Actions ──────────────────────────────────────────────────────────────
  const handleDownloadPdf = useCallback(async (invoiceId: string) => {
    setPdfLoading(invoiceId)
    try {
      const url = await generateInvoicePdf(invoiceId)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      alert('Failed to generate PDF. Please try again.')
    } finally {
      setPdfLoading(null)
    }
  }, [])

  const handleExportInvoices = useCallback(() => {
    setExportingInv(true)
    try {
      const startMs = exportStart ? new Date(exportStart + 'T00:00:00').getTime() : 0
      const endMs   = exportEnd   ? new Date(exportEnd   + 'T23:59:59').getTime() : Infinity
      const ranged  = invoices.filter((inv) => {
        const ms = inv.issuedAt?.toDate?.().getTime() ?? 0
        return ms >= startMs && ms <= endMs
      })
      exportInvoicesToCsv(ranged, customers)
    } finally {
      setExportingInv(false)
    }
  }, [exportStart, exportEnd, invoices, customers])

  const handleExportPayments = useCallback(async () => {
    if (!exportStart || !exportEnd) return
    setExportingPay(true)
    try {
      const startDt = new Date(exportStart + 'T00:00:00')
      const endDt   = new Date(exportEnd   + 'T23:59:59')
      const payments = await fetchPaymentsInRange(startDt, endDt)
      exportPaymentsToCsv(payments, customers, invoices)
    } finally {
      setExportingPay(false)
    }
  }, [exportStart, exportEnd, customers, invoices])

  const handleAgingClick = useCallback((idx: number) => {
    setAgingFilter((prev) => (prev === idx ? null : idx))
  }, [])

  const clearFilters = useCallback(() => {
    setFilterStatus('all')
    setFilterDateStart('')
    setFilterDateEnd('')
    setFilterCustomer('')
    setAgingFilter(null)
  }, [])

  const hasActiveFilters =
    filterStatus !== 'all' || filterDateStart || filterDateEnd ||
    filterCustomer || agingFilter !== null

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="bd page-layout">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="page-header">
        <div className="page-header__title-section">
          <h1 className="page-header__title">Billing</h1>
          <p className="page-header__description">Manage invoice flow, receivables, and follow-up actions from a single operational workspace.</p>
        </div>
      </div>

      {/* ── 1. Summary stat cards ────────────────────────────────────────── */}
      <div className="page-section-grid page-section-grid--4col">
        <StatCard
          label="Revenue This Month"
          value={formatCurrency(stats.revenueThisMonth)}
          sub="Collected (paid invoices)"
        />
        <StatCard
          label="Outstanding"
          value={formatCurrency(stats.outstanding)}
          sub="All pending invoices"
        />
        <StatCard
          label="Overdue"
          value={formatCurrency(stats.overdue)}
          sub="Past due date"
          danger
        />
        <StatCard
          label="Avg Days to Pay"
          value={`${stats.avgDaysToPay} days`}
          sub="Issued → paid"
        />
      </div>

      {/* ── 2. Invoice list ──────────────────────────────────────────────── */}
      <Card className="bd__invoice-card">
        <div className="bd__invoice-header">
          <h2 className="bd__section-title">
            Invoices
            {agingFilter !== null && (
              <span className="bd__aging-active-label">
                — {agingBuckets[agingFilter].label}
                <button type="button" className="bd__aging-clear" onClick={() => setAgingFilter(null)} aria-label="Clear aging filter">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </span>
            )}
          </h2>
          <span className="bd__invoice-count">
            {filteredInvoices.length} invoice{filteredInvoices.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="bd__controls">
          <div className="bd__controls-left">
            <select
              className="bd__filter-select"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as InvoiceStatus | 'all')}
              aria-label="Filter by status"
            >
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
              <option value="void">Void</option>
            </select>
          </div>

          <div className="bd__controls-right">
            <div className="bd__date-range">
              <input
                type="date"
                className="bd__filter-date"
                value={filterDateStart}
                max={filterDateEnd || undefined}
                onChange={(e) => setFilterDateStart(e.target.value)}
                aria-label="Filter from date"
              />
              <input
                type="date"
                className="bd__filter-date"
                value={filterDateEnd}
                min={filterDateStart || undefined}
                onChange={(e) => setFilterDateEnd(e.target.value)}
                aria-label="Filter to date"
              />
            </div>

            <div className="bd__search-wrap">
              <svg className="bd__search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="search"
                className="bd__filter-search"
                placeholder="Search customer"
                value={filterCustomer}
                onChange={(e) => setFilterCustomer(e.target.value)}
                aria-label="Search by customer"
              />
            </div>

            {hasActiveFilters && (
              <button type="button" className="bd__filter-clear" onClick={clearFilters}>
                Reset
              </button>
            )}
          </div>
        </div>

        <div className="bd__table-shell">
          {isLoading ? (
            <div className="bd__skeleton-rows">
              {[...Array(5)].map((_, i) => <div key={i} className="bd__skeleton-row" />)}
            </div>
          ) : null}

          <div className="bd__table-wrap">
            <table className="bd__table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Customer</th>
                  <th>Order</th>
                  <th>Issued</th>
                  <th>Due</th>
                  <th className="bd__col-r">Total</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {!isLoading && filteredInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="bd__empty-cell">
                      <div className="bd__empty-state">
                        <p className="bd__empty">No invoices match the current filters.</p>
                      </div>
                    </td>
                  </tr>
                ) : null}

                {!isLoading && filteredInvoices.map((inv) => {
                  const cust = customerMap.get(inv.customerId)
                  return (
                    <tr key={inv.id}>
                      <td className="bd__inv-num">{inv.invoiceNumber}</td>
                      <td>{cust?.name ?? inv.customerId}</td>
                      <td className="bd__order-id">{inv.orderId ?? '—'}</td>
                      <td className="bd__date">{formatDate(inv.issuedAt)}</td>
                      <td className="bd__date">{formatDate(inv.dueAt)}</td>
                      <td className="bd__col-r">{formatCurrency(inv.total)}</td>
                      <td><InvoiceStatusBadge invoice={inv} /></td>
                      <td>
                        <div className="bd__actions">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setViewInvoice(inv)}
                          >
                            View
                          </Button>
                          {inv.status === 'draft' && (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => sentMutation.mutate(inv.id)}
                              disabled={sentMutation.isPending}
                            >
                              Send
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleDownloadPdf(inv.id)}
                            disabled={pdfLoading === inv.id}
                          >
                            {pdfLoading === inv.id ? '…' : 'PDF'}
                          </Button>
                          {inv.status !== 'paid' && inv.status !== 'void' && (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => paidMutation.mutate(inv.id)}
                              disabled={paidMutation.isPending}
                            >
                              Mark paid
                            </Button>
                          )}
                          {inv.status !== 'void' && inv.status !== 'paid' && (
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => setVoidTarget(inv)}
                            >
                              Void
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      {/* ── 3. Aging report ──────────────────────────────────────────────── */}
      <Card className="bd__aging-panel">
        <div className="bd__aging-section">
        <h2 className="bd__section-title">Accounts Receivable Aging</h2>
        <p className="bd__aging-hint">Click a card to filter the invoice list above.</p>
        <div className="bd__aging-cards">
          {agingBuckets.map((bucket, i) => (
            <AgingCard
              key={bucket.label}
              label={bucket.label}
              total={bucket.total}
              count={bucket.count}
              accentIndex={i}
              active={agingFilter === i}
              onClick={() => handleAgingClick(i)}
            />
          ))}
        </div>
        </div>
      </Card>

      {/* ── 4. Export section ────────────────────────────────────────────── */}
      <Card className="bd__export-card">
        <h2 className="bd__section-title">Export</h2>
        <div className="bd__export-range">
          <span className="bd__export-range-label">Date range</span>
          <div className="bd__export-range-inputs">
            <input
              type="date"
              className="bd__filter-date"
              value={exportStart}
              max={exportEnd || undefined}
              onChange={(e) => setExportStart(e.target.value)}
              aria-label="Export start date"
            />
            <span className="bd__filter-sep">–</span>
            <input
              type="date"
              className="bd__filter-date"
              value={exportEnd}
              min={exportStart || undefined}
              max={isoDate(new Date())}
              onChange={(e) => setExportEnd(e.target.value)}
              aria-label="Export end date"
            />
          </div>
        </div>
        <div className="bd__export-btns">
          <Button
            variant="secondary"
            onClick={handleExportInvoices}
            loading={exportingInv}
            disabled={isLoading}
          >
            Export Invoices CSV
          </Button>
          <Button
            variant="secondary"
            onClick={handleExportPayments}
            loading={exportingPay}
            disabled={!exportStart || !exportEnd}
          >
            Export Payments CSV
          </Button>
        </div>
      </Card>

      {/* ── 5. Credit holds ──────────────────────────────────────────────── */}
      <Card className="bd__holds-card">
        <h2 className="bd__section-title">
          Credit Holds
          {holdAccounts.length > 0 && (
            <span className="bd__holds-badge">{holdAccounts.length}</span>
          )}
        </h2>
        {isLoading ? (
          <div className="bd__skeleton-rows">
            {[...Array(3)].map((_, i) => <div key={i} className="bd__skeleton-row" />)}
          </div>
        ) : holdAccounts.length === 0 ? (
          <p className="bd__empty">No accounts currently on hold.</p>
        ) : (
          <ul className="bd__holds-list">
            {holdAccounts.map(({ customer, balance }) => (
              <li key={customer.id} className="bd__hold-row">
                <div className="bd__hold-info">
                  <span className="bd__hold-name">{customer.name}</span>
                  <span className="bd__hold-reason">
                    {(customer as unknown as Record<string, unknown>).holdReason as string | undefined
                      ?? 'Account on hold'}
                  </span>
                </div>
                <div className="bd__hold-right">
                  <span className="bd__hold-balance">{formatCurrency(balance)}</span>
                  <Badge variant="danger">Hold</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ── Invoice detail modal ─────────────────────────────────────────── */}
      <InvoiceDetailModal
        invoice={viewInvoice}
        customerMap={customerMap}
        onClose={() => setViewInvoice(null)}
      />

      {/* ── Void confirm modal ───────────────────────────────────────────── */}
      <Modal
        open={!!voidTarget}
        onClose={() => setVoidTarget(null)}
        title="Void Invoice"
        size="sm"
      >
        <p className="bd__void-body">
          Are you sure you want to void{' '}
          <strong>{voidTarget?.invoiceNumber}</strong>?{' '}
          This cannot be undone.
        </p>
        <div className="bd__void-actions">
          <Button variant="ghost" onClick={() => setVoidTarget(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => voidTarget && voidMutation.mutate(voidTarget.id)}
            loading={voidMutation.isPending}
          >
            Void Invoice
          </Button>
        </div>
      </Modal>

    </div>
  )
}

export default BillingDashboard
