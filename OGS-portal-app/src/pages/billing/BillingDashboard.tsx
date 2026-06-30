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
import { customersCol, ordersCol } from '../../lib/firestore'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { StatCard } from '../../components/ui/StatCard'
import { StatusBadge } from '../../components/ui/StatusBadge'
import type { Customer } from '../../types/customer'
import type { Order, OrderStatus } from '../../types/order'
import './BillingDashboard.css'

type RevenueStatusFilter = 'all' | 'ready_to_invoice' | 'invoice_sent' | 'paid'
type SortKey = 'date' | 'amount' | 'received'
type SortDirection = 'asc' | 'desc'
type DatePreset = 'all_time' | 'last_30_days' | 'this_month' | 'custom'

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending',
  scheduled: 'Scheduled',
  assigned: 'Assigned',
  'in-transit': 'In Transit',
  in_transit: 'In Transit',
  delivered: 'Delivered',
  invoice_sent_pending: 'Invoice Pending',
  ready_to_invoice: 'Ready to Invoice',
  invoice_sent: 'Invoice Sent',
  paid: 'Paid',
  cancelled: 'Cancelled',
  archived: 'Archived',
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

function getOrderDate(order: Order): Date | null {
  return order.deliveredAt?.toDate?.() ?? order.scheduledAt?.toDate?.() ?? order.requestedAt?.toDate?.() ?? null
}

function toInputDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function fetchAllOrders(): Promise<Order[]> {
  return getDocs(query(ordersCol, orderBy('requestedAt', 'desc')))
    .then((snap) => snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Order))
}

function fetchAllCustomers(): Promise<Customer[]> {
  return getDocs(query(customersCol, orderBy('name')))
    .then((snap) => snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Customer))
}

const STATUS_TONE: Partial<Record<OrderStatus, string>> = {
  pending: 'pending',
  scheduled: 'scheduled',
  assigned: 'scheduled',
  'in-transit': 'in_transit',
  in_transit: 'in_transit',
  delivered: 'delivered',
  invoice_sent_pending: 'pending',
  ready_to_invoice: 'pending',
  invoice_sent: 'invoice_sent',
  paid: 'paid',
  cancelled: 'cancelled',
  archived: 'draft',
}

const BillingDashboard: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const crmBase = location.pathname.startsWith('/admin') ? '/admin/crm' : '/crm'

  // Default to all-time so billing and orders counts align unless user narrows dates.
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [datePreset, setDatePreset] = useState<DatePreset>('all_time')
  const [statusFilter, setStatusFilter] = useState<RevenueStatusFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  const applyDatePreset = (preset: DatePreset) => {
    const now = new Date()
    const today = toInputDate(now)

    if (preset === 'all_time') {
      setFromDate('')
      setToDate('')
      setDatePreset('all_time')
      return
    }

    if (preset === 'last_30_days') {
      const start = new Date(now)
      start.setDate(start.getDate() - 30)
      setFromDate(toInputDate(start))
      setToDate(today)
      setDatePreset('last_30_days')
      return
    }

    if (preset === 'this_month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      setFromDate(toInputDate(start))
      setToDate(today)
      setDatePreset('this_month')
      return
    }

    setDatePreset('custom')
  }

  const ordersQuery = useQuery({
    queryKey: ['billing', 'orders'],
    queryFn: fetchAllOrders,
    staleTime: 2 * 60 * 1000,
  })

  const customersQuery = useQuery({
    queryKey: ['billing', 'customers'],
    queryFn: fetchAllCustomers,
    staleTime: 5 * 60 * 1000,
  })

  const orders = ordersQuery.data ?? []
  const customers = customersQuery.data ?? []
  const isLoading = ordersQuery.isPending || customersQuery.isPending

  const customerMap = useMemo(
    () => new Map(customers.map((c) => [c.id, c.name])),
    [customers],
  )

  const fromTime = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null
  const toTime = toDate ? new Date(`${toDate}T23:59:59`).getTime() : null

  const dateFilteredOrders = useMemo(() => orders.filter((order) => {
    if (!['ready_to_invoice', 'invoice_sent', 'paid'].includes(order.status)) return false
    const orderDate = getOrderDate(order)
    if (!orderDate) return false
    const value = orderDate.getTime()

    if (fromTime !== null && value < fromTime) return false
    if (toTime !== null && value > toTime) return false
    return true
  }), [orders, fromTime, toTime])

  const kpis = useMemo(() => {
    let totalInvoiced = 0
    let totalCollected = 0
    let pendingInvoiceCount = 0

    for (const order of dateFilteredOrders) {
      if (order.status === 'invoice_sent' || order.status === 'paid') {
        totalInvoiced += order.invoiceAmount ?? 0
      }
      if (order.status === 'paid') {
        totalCollected += (order.paidAmount ?? 0) > 0 ? (order.paidAmount ?? 0) : (order.invoiceAmount ?? 0)
      }
      if (order.status === 'ready_to_invoice') {
        pendingInvoiceCount += 1
      }
    }

    return {
      totalInvoiced,
      totalCollected,
      outstanding: totalInvoiced - totalCollected,
      pendingInvoiceCount,
    }
  }, [dateFilteredOrders])

  const statusFilteredOrders = useMemo(() => {
    if (statusFilter === 'all') return dateFilteredOrders
    return dateFilteredOrders.filter((order) => order.status === statusFilter)
  }, [dateFilteredOrders, statusFilter])

  const sortedOrders = useMemo(() => {
    const sorted = [...statusFilteredOrders]
    sorted.sort((a, b) => {
      let aValue = 0
      let bValue = 0

      if (sortKey === 'date') {
        aValue = getOrderDate(a)?.getTime() ?? 0
        bValue = getOrderDate(b)?.getTime() ?? 0
      }

      if (sortKey === 'amount') {
        aValue = a.invoiceAmount ?? Number.NEGATIVE_INFINITY
        bValue = b.invoiceAmount ?? Number.NEGATIVE_INFINITY
      }

      if (sortKey === 'received') {
        aValue = a.status === 'paid' ? ((a.paidAmount ?? 0) > 0 ? (a.paidAmount ?? 0) : (a.invoiceAmount ?? 0)) : 0
        bValue = b.status === 'paid' ? ((b.paidAmount ?? 0) > 0 ? (b.paidAmount ?? 0) : (b.invoiceAmount ?? 0)) : 0
      }

      return sortDirection === 'asc' ? aValue - bValue : bValue - aValue
    })

    return sorted
  }, [statusFilteredOrders, sortKey, sortDirection])

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
    { key: 'ready_to_invoice', label: 'Ready to Invoice' },
    { key: 'invoice_sent', label: 'Invoice Sent' },
    { key: 'paid', label: 'Paid' },
  ]

  return (
    <div className="bd page-layout">
      <header className="page-header">
        <div className="page-header__hero">
          <div className="page-header__title-section">
            <p className="page-header__eyebrow">Revenue Operations</p>
            <h1 className="page-header__title">Revenue</h1>
            <p className="page-header__description">Track invoiced and collected revenue from the same order records shown in Operations.</p>
          </div>
          <div className="page-header__actions">
            <span className="page-header__meta-tag">Admin + Billing</span>
          </div>
        </div>
      </header>

      <div className="bd__controls">
        <div className="bd__date-presets" aria-label="Date presets">
          <button
            type="button"
            className={`page-filters__preset${datePreset === 'all_time' ? ' page-filters__preset--active' : ''}`}
            onClick={() => applyDatePreset('all_time')}
          >
            All Time
          </button>
          <button
            type="button"
            className={`page-filters__preset${datePreset === 'last_30_days' ? ' page-filters__preset--active' : ''}`}
            onClick={() => applyDatePreset('last_30_days')}
          >
            Last 30 Days
          </button>
          <button
            type="button"
            className={`page-filters__preset${datePreset === 'this_month' ? ' page-filters__preset--active' : ''}`}
            onClick={() => applyDatePreset('this_month')}
          >
            This Month
          </button>
        </div>
        <div className="bd__date-range">
          <input
            type="date"
            className="bd__filter-date"
            value={fromDate}
            max={toDate || undefined}
            onChange={(e) => {
              setFromDate(e.target.value)
              setDatePreset('custom')
            }}
            aria-label="From date"
          />
          <input
            type="date"
            className="bd__filter-date"
            value={toDate}
            min={fromDate || undefined}
            onChange={(e) => {
              setToDate(e.target.value)
              setDatePreset('custom')
            }}
            aria-label="To date"
          />
          {datePreset === 'custom' && (
            <span className="bd__range-note">Custom range</span>
          )}
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
          onClick={() => setStatusFilter('ready_to_invoice')}
        >
          <StatCard label="Orders Pending Invoice" value={kpis.pendingInvoiceCount} subLabel="Click to filter" accent />
        </button>
      </div>

      <Card className="bd__revenue-card">
        <div className="bd__revenue-header">
          <h2 className="bd__section-title">Revenue Orders</h2>
          <span className="bd__invoice-count">{sortedOrders.length} order{sortedOrders.length !== 1 ? 's' : ''}</span>
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
                {!isLoading && sortedOrders.length === 0 ? (
                  <tr className="page-table__tr">
                    <td colSpan={7} className="page-table__td bd__empty-cell">
                      <div className="bd__empty-state">
                        <p className="bd__empty">No orders match the current filters.</p>
                      </div>
                    </td>
                  </tr>
                ) : null}

                {!isLoading && sortedOrders.map((order) => {
                  const customerName = customerMap.get(order.customerId) ?? order.customerId
                  return (
                    <tr key={order.id} className="page-table__tr">
                      <td className="page-table__td bd__date">{formatDate(order.deliveredAt ?? order.scheduledAt ?? order.requestedAt)}</td>
                      <td className="page-table__td">{order.qbInvoiceNumber || '—'}</td>
                      <td className="page-table__td">{customerName}</td>
                      <td className="page-table__td page-table__td--right">{formatCurrency(order.invoiceAmount)}</td>
                      <td className="page-table__td page-table__td--right">{formatCurrency(order.status === 'paid' ? (((order.paidAmount ?? 0) > 0 ? (order.paidAmount ?? 0) : (order.invoiceAmount ?? 0))) : 0)}</td>
                      <td className="page-table__td">
                        <StatusBadge status={STATUS_TONE[order.status] ?? 'draft'} label={STATUS_LABEL[order.status]} />
                      </td>
                      <td className="page-table__td">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => navigate(`${crmBase}/customers/${order.customerId}`)}
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

          {!isLoading && sortedOrders.length > 0 && (
            <div className="bd__mobile-cards">
              {sortedOrders.map((order) => {
                const customerName = customerMap.get(order.customerId) ?? order.customerId
                return (
                  <div key={`mobile-${order.id}`} className="bd__mobile-card-wrap">
                    <div className="bd__mobile-card">
                      <div className="bd__mobile-card-header">
                        <div>
                          <strong>{order.qbInvoiceNumber || '—'}</strong>
                          <small>{customerName}</small>
                        </div>
                        <StatusBadge status={STATUS_TONE[order.status] ?? 'draft'} label={STATUS_LABEL[order.status]} />
                      </div>
                      <div className="bd__mobile-revenue-meta">
                        <div>
                          <span>Date</span>
                          <strong>{formatDate(order.deliveredAt ?? order.scheduledAt ?? order.requestedAt)}</strong>
                        </div>
                        <div>
                          <span>Total</span>
                          <strong>{formatCurrency(order.invoiceAmount)}</strong>
                        </div>
                        <div>
                          <span>Collected</span>
                          <strong>{formatCurrency(order.status === 'paid' ? (((order.paidAmount ?? 0) > 0 ? (order.paidAmount ?? 0) : (order.invoiceAmount ?? 0))) : 0)}</strong>
                        </div>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => navigate(`${crmBase}/customers/${order.customerId}`)}
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
