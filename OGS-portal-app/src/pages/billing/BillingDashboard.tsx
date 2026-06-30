/**
 * src/pages/billing/BillingDashboard.tsx
 *
 * Revenue dashboard (QuickBooks-aligned) accessible at /ops/billing and /admin/ops/billing.
 * Displays invoices from the invoices collection (source of truth for billing).
 */

import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { getDocs, orderBy, query } from 'firebase/firestore'
import { customersCol, invoicesCol } from '../../lib/firestore'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { StatCard } from '../../components/ui/StatCard'
import { StatusBadge } from '../../components/ui/StatusBadge'
import type { Customer } from '../../types/customer'
import type { Invoice, InvoiceStatus } from '../../types/billing'
import './BillingDashboard.css'

type RevenueStatusFilter = 'all' | 'sent' | 'overdue' | 'paid'
type SortKey = 'date' | 'amount' | 'received'
type SortDirection = 'asc' | 'desc'

// Map Invoice status to display label
const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  delivered: 'Delivered',
  paid: 'Paid',
  overdue: 'Overdue',
  void: 'Void',
}

function formatCurrency(value: number | null | undefined): string {
  if (typeof value !== 'number') return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(value)
}

function formatDate(ts: { toDate?: () => Date } | null | undefined): string {
  if (!ts?.toDate) return '—'
  return ts.toDate().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function getInvoiceDate(invoice: Invoice): Date | null {
  return invoice.issuedAt?.toDate?.() ?? null
}

function fetchAllInvoices(): Promise<Invoice[]> {
  return getDocs(query(invoicesCol, orderBy('issuedAt', 'desc')))
    .then((snap) => snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Invoice))
}

function fetchAllCustomers(): Promise<Customer[]> {
  return getDocs(query(customersCol, orderBy('name')))
    .then((snap) => snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Customer))
}

const INVOICE_TONE_MAP: Record<InvoiceStatus, string> = {
  draft: 'draft',
  sent: 'invoice_sent',
  delivered: 'invoice_sent',
  paid: 'paid',
  overdue: 'pending',
  void: 'draft',
}

const BillingDashboard: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const crmBase = location.pathname.startsWith('/admin') ? '/admin/crm' : '/crm'

  // Default to all-time so billing and orders counts align unless user narrows dates.
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [statusFilter, setStatusFilter] = useState<RevenueStatusFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  const invoicesQuery = useQuery({
    queryKey: ['billing', 'invoices'],
    queryFn: fetchAllInvoices,
    staleTime: 2 * 60 * 1000,
  })

  const customersQuery = useQuery({
    queryKey: ['billing', 'customers'],
    queryFn: fetchAllCustomers,
    staleTime: 5 * 60 * 1000,
  })

  const invoices = invoicesQuery.data ?? []
  const customers = customersQuery.data ?? []
  const isLoading = invoicesQuery.isPending || customersQuery.isPending

  const customerMap = useMemo(
    () => new Map(customers.map((c) => [c.id, c.name])),
    [customers],
  )

  const fromTime = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null
  const toTime = toDate ? new Date(`${toDate}T23:59:59`).getTime() : null

  const dateFilteredInvoices = useMemo(() => invoices.filter((invoice) => {
    const invoiceDate = getInvoiceDate(invoice)
    if (!invoiceDate) return false
    const value = invoiceDate.getTime()

    if (fromTime !== null && value < fromTime) return false
    if (toTime !== null && value > toTime) return false
    return true
  }), [invoices, fromTime, toTime])

  const kpis = useMemo(() => {
    let totalInvoiced = 0
    let totalCollected = 0
    let pendingInvoiceCount = 0

    for (const invoice of dateFilteredInvoices) {
      totalInvoiced += invoice.total ?? 0
      if (invoice.status === 'paid') {
        totalCollected += invoice.total ?? 0
      }
      if (invoice.status === 'sent' || invoice.status === 'overdue') {
        pendingInvoiceCount += 1
      }
    }

    return {
      totalInvoiced,
      totalCollected,
      outstanding: totalInvoiced - totalCollected,
      pendingInvoiceCount,
    }
  }, [dateFilteredInvoices])

  const statusFilteredInvoices = useMemo(() => {
    if (statusFilter === 'all') return dateFilteredInvoices
    // Filter out draft invoices unless specifically requested
    if (statusFilter === 'sent') {
      return dateFilteredInvoices.filter((inv) => inv.status === 'sent' || inv.status === 'delivered')
    }
    return dateFilteredInvoices.filter((inv) => inv.status === statusFilter)
  }, [dateFilteredInvoices, statusFilter])

  const sortedInvoices = useMemo(() => {
    const sorted = [...statusFilteredInvoices]
    sorted.sort((a, b) => {
      let aValue = 0
      let bValue = 0

      if (sortKey === 'date') {
        aValue = getInvoiceDate(a)?.getTime() ?? 0
        bValue = getInvoiceDate(b)?.getTime() ?? 0
      }

      if (sortKey === 'amount') {
        aValue = a.total ?? Number.NEGATIVE_INFINITY
        bValue = b.total ?? Number.NEGATIVE_INFINITY
      }

      if (sortKey === 'received') {
        aValue = a.status === 'paid' ? a.total ?? 0 : 0
        bValue = b.status === 'paid' ? b.total ?? 0 : 0
      }

      return sortDirection === 'asc' ? aValue - bValue : bValue - aValue
    })

    return sorted
  }, [statusFilteredInvoices, sortKey, sortDirection])

  const toggleSort = (nextKey: SortKey) => {
    if (sortKey === nextKey) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(nextKey)
    setSortDirection(nextKey === 'date' ? 'desc' : 'asc')
  }

  const statusFilters: Array<{ key: RevenueStatusFilter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'sent', label: 'Outstanding' },
    { key: 'overdue', label: 'Overdue' },
    { key: 'paid', label: 'Paid' },
  ]

  return (
    <div className="bd page-layout">
      <header className="page-header">
        <div className="page-header__hero">
          <div className="page-header__title-section">
            <p className="page-header__eyebrow">Revenue Operations</p>
            <h1 className="page-header__title">Revenue</h1>
            <p className="page-header__description">Track invoiced and collected revenue from the invoices collection.</p>
          </div>
          <div className="page-header__actions">
            <span className="page-header__meta-tag">Admin + Billing</span>
          </div>
        </div>
      </header>

      <div className="bd__controls">
        <div className="bd__date-range">
          <input
            type="date"
            className="bd__filter-date"
            value={fromDate}
            max={toDate || undefined}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label="From date"
          />
          <input
            type="date"
            className="bd__filter-date"
            value={toDate}
            min={fromDate || undefined}
            onChange={(e) => setToDate(e.target.value)}
            aria-label="To date"
          />
        </div>
      </div>

      <div className="bd__kpis">
        <StatCard label="Total Invoiced" value={formatCurrency(kpis.totalInvoiced)} accent />
        <StatCard label="Total Collected" value={formatCurrency(kpis.totalCollected)} accent />
        <StatCard label="Outstanding" value={formatCurrency(kpis.outstanding)} accent />
        <button
          type="button"
          className="bd__pending-stat"
          role="button"
          onClick={() => setStatusFilter('sent')}
        >
          <StatCard label="Outstanding Invoices" value={kpis.pendingInvoiceCount} subLabel="Click to filter" accent />
        </button>
      </div>

      <Card className="bd__revenue-card">
        <div className="bd__revenue-header">
          <h2 className="bd__section-title">Invoices</h2>
          <span className="bd__invoice-count">{sortedInvoices.length} invoice{sortedInvoices.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="bd__chips" aria-label="Revenue status filters">
          {statusFilters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={`page-filters__preset${statusFilter === filter.key ? ' page-filters__preset--active' : ''}`}
              onClick={() => setStatusFilter(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="bd__table-shell">
          {isLoading ? (
            <div className="bd__skeleton-rows">
              {[...Array(5)].map((_, i) => <div key={i} className="bd__skeleton-row" />)}
            </div>
          ) : null}

          <div className="page-table-wrap bd__table-wrap">
            <table className="page-table bd__table">
              <thead className="page-table__head">
                <tr>
                  <th className="page-table__th">
                    <button type="button" className="bd__sort-btn" onClick={() => toggleSort('date')}>
                      Date
                    </button>
                  </th>
                  <th className="page-table__th">Invoice #</th>
                  <th className="page-table__th">Customer</th>
                  <th className="page-table__th page-table__th--right">
                    <button type="button" className="bd__sort-btn bd__sort-btn--right" onClick={() => toggleSort('amount')}>
                      Total
                    </button>
                  </th>
                  <th className="page-table__th page-table__th--right">
                    <button type="button" className="bd__sort-btn bd__sort-btn--right" onClick={() => toggleSort('received')}>
                      Collected
                    </button>
                  </th>
                  <th className="page-table__th">Status</th>
                  <th className="page-table__th">Actions</th>
                </tr>
              </thead>
              <tbody className="page-table__tbody">
                {!isLoading && sortedInvoices.length === 0 ? (
                  <tr className="page-table__tr">
                    <td colSpan={7} className="page-table__td bd__empty-cell">
                      <div className="bd__empty-state">
                        <p className="bd__empty">No invoices match the current filters.</p>
                      </div>
                    </td>
                  </tr>
                ) : null}

                {!isLoading && sortedInvoices.map((invoice) => {
                  const customerName = customerMap.get(invoice.customerId) ?? invoice.customerId
                  return (
                    <tr key={invoice.id} className="page-table__tr">
                      <td className="page-table__td bd__date">{formatDate(invoice.issuedAt)}</td>
                      <td className="page-table__td">{invoice.invoiceNumber || '—'}</td>
                      <td className="page-table__td">{customerName}</td>
                      <td className="page-table__td page-table__td--right">{formatCurrency(invoice.total)}</td>
                      <td className="page-table__td page-table__td--right">{formatCurrency(invoice.status === 'paid' ? invoice.total : 0)}</td>
                      <td className="page-table__td">
                        <StatusBadge status={INVOICE_TONE_MAP[invoice.status]} label={INVOICE_STATUS_LABEL[invoice.status]} />
                      </td>
                      <td className="page-table__td">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => navigate(`${crmBase}/customers/${invoice.customerId}`)}
                        >
                          View
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {!isLoading && sortedInvoices.length > 0 && (
            <div className="bd__mobile-cards">
              {sortedInvoices.map((invoice) => {
                const customerName = customerMap.get(invoice.customerId) ?? invoice.customerId
                return (
                  <div key={`mobile-${invoice.id}`} className="bd__mobile-card-wrap">
                    <div className="bd__mobile-card">
                      <div className="bd__mobile-card-header">
                        <div>
                          <strong>{invoice.invoiceNumber}</strong>
                          <small>{customerName}</small>
                        </div>
                        <StatusBadge status={INVOICE_TONE_MAP[invoice.status]} label={INVOICE_STATUS_LABEL[invoice.status]} />
                      </div>
                      <div className="bd__mobile-revenue-meta">
                        <div>
                          <span>Date</span>
                          <strong>{formatDate(invoice.issuedAt)}</strong>
                        </div>
                        <div>
                          <span>Total</span>
                          <strong>{formatCurrency(invoice.total)}</strong>
                        </div>
                        <div>
                          <span>Collected</span>
                          <strong>{formatCurrency(invoice.status === 'paid' ? invoice.total : 0)}</strong>
                        </div>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => navigate(`${crmBase}/customers/${invoice.customerId}`)}
                      >
                        View Details
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

export default BillingDashboard
