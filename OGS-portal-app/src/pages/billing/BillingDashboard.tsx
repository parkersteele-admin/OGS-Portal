/**
 * src/pages/billing/BillingDashboard.tsx
 *
 * Revenue dashboard (QuickBooks-aligned) accessible at /ops/billing and /admin/ops/billing.
 */

import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { getDocs, orderBy, query } from 'firebase/firestore'
import { customersCol, ordersCol } from '../../lib/firestore'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import MobileOrderCard from '../../components/orders/MobileOrderCard'
import type { Customer } from '../../types/customer'
import type { Order, OrderStatus } from '../../types/order'
import './BillingDashboard.css'

type RevenueStatusFilter = 'all' | 'ready_to_invoice' | 'invoice_sent' | 'paid'
type SortKey = 'date' | 'invoiced' | 'received'
type SortDirection = 'asc' | 'desc'
type BadgeVariant = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'

const STATUS_VARIANT: Record<OrderStatus, BadgeVariant> = {
  pending: 'warning',
  scheduled: 'info',
  assigned: 'info',
  'in-transit': 'brand',
  delivered: 'success',
  ready_to_invoice: 'warning',
  invoice_sent: 'info',
  paid: 'success',
  cancelled: 'danger',
  archived: 'neutral',
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending',
  scheduled: 'Scheduled',
  assigned: 'Assigned',
  'in-transit': 'In Transit',
  delivered: 'Delivered',
  ready_to_invoice: 'Ready to Invoice',
  invoice_sent: 'Invoice Sent',
  paid: 'Paid',
  cancelled: 'Cancelled',
  archived: 'Archived',
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function monthRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  return { from: isoDate(start), to: isoDate(now) }
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
  return order.deliveredAt?.toDate?.() ?? order.scheduledAt?.toDate?.() ?? null
}

function fetchAllOrders(): Promise<Order[]> {
  return getDocs(query(ordersCol, orderBy('requestedAt', 'desc')))
    .then((snap) => snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Order))
}

function fetchAllCustomers(): Promise<Customer[]> {
  return getDocs(query(customersCol, orderBy('name')))
    .then((snap) => snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Customer))
}

const StatusBadge: React.FC<{ status: OrderStatus }> = ({ status }) => (
  <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
)

const BillingDashboard: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const range = monthRange()
  const opsBase = location.pathname.startsWith('/admin') ? '/admin/ops' : '/ops'

  const [fromDate, setFromDate] = useState(range.from)
  const [toDate, setToDate] = useState(range.to)
  const [statusFilter, setStatusFilter] = useState<RevenueStatusFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

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
        totalCollected += order.paidAmount ?? 0
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

      if (sortKey === 'invoiced') {
        aValue = a.invoiceAmount ?? Number.NEGATIVE_INFINITY
        bValue = b.invoiceAmount ?? Number.NEGATIVE_INFINITY
      }

      if (sortKey === 'received') {
        aValue = a.paidAmount ?? Number.NEGATIVE_INFINITY
        bValue = b.paidAmount ?? Number.NEGATIVE_INFINITY
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
      <div className="page-header">
        <div className="page-header__title-section">
          <h1 className="page-header__title">Revenue</h1>
          <p className="page-header__description">Track invoiced and collected revenue aligned with QuickBooks workflow.</p>
        </div>
      </div>

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
        <Card className="bd__kpi-card">
          <p className="bd__kpi-label bd__kpi-label--blue">TOTAL INVOICED</p>
          <p className="bd__kpi-value">{formatCurrency(kpis.totalInvoiced)}</p>
        </Card>
        <Card className="bd__kpi-card">
          <p className="bd__kpi-label bd__kpi-label--green">TOTAL COLLECTED</p>
          <p className="bd__kpi-value">{formatCurrency(kpis.totalCollected)}</p>
        </Card>
        <Card className="bd__kpi-card">
          <p className="bd__kpi-label bd__kpi-label--orange">OUTSTANDING</p>
          <p className="bd__kpi-value">{formatCurrency(kpis.outstanding)}</p>
        </Card>
        <Card
          className="bd__kpi-card bd__kpi-card--clickable"
          role="button"
          tabIndex={0}
          onClick={() => setStatusFilter('ready_to_invoice')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setStatusFilter('ready_to_invoice')
            }
          }}
        >
          <p className="bd__kpi-label bd__kpi-label--neutral">ORDERS PENDING INVOICE</p>
          <p className="bd__kpi-value">{kpis.pendingInvoiceCount}</p>
        </Card>
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
              className={`bd__chip${statusFilter === filter.key ? ' bd__chip--active' : ''}`}
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

          <div className="bd__table-wrap">
            <table className="bd__table">
              <thead>
                <tr>
                  <th>
                    <button type="button" className="bd__sort-btn" onClick={() => toggleSort('date')}>
                      Date
                    </button>
                  </th>
                  <th>Customer</th>
                  <th>QB Invoice #</th>
                  <th className="bd__col-r">
                    <button type="button" className="bd__sort-btn bd__sort-btn--right" onClick={() => toggleSort('invoiced')}>
                      Invoiced
                    </button>
                  </th>
                  <th className="bd__col-r">
                    <button type="button" className="bd__sort-btn bd__sort-btn--right" onClick={() => toggleSort('received')}>
                      Received
                    </button>
                  </th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {!isLoading && sortedOrders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="bd__empty-cell">
                      <div className="bd__empty-state">
                        <p className="bd__empty">No orders match the current filters.</p>
                      </div>
                    </td>
                  </tr>
                ) : null}

                {!isLoading && sortedOrders.map((order) => {
                  const customerName = customerMap.get(order.customerId) ?? order.customerId
                  return (
                    <tr key={order.id}>
                      <td className="bd__date">{formatDate(order.deliveredAt ?? order.scheduledAt)}</td>
                      <td>{customerName}</td>
                      <td className="bd__inv-num">{order.qbInvoiceNumber || '—'}</td>
                      <td className="bd__col-r">{formatCurrency(order.invoiceAmount)}</td>
                      <td className="bd__col-r">{formatCurrency(order.paidAmount)}</td>
                      <td><StatusBadge status={order.status} /></td>
                      <td>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => navigate(`${opsBase}/orders?orderId=${order.id}`)}
                        >
                          Update Billing
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
                    <MobileOrderCard
                      order={{
                        ...order,
                        customerName,
                        productName: `QB Invoice # ${order.qbInvoiceNumber || '—'}`,
                        productUnit: '',
                        quantityLabel: 0,
                      } as Order}
                      primaryAction={{
                        label: 'Update Billing',
                        icon: FileText,
                        onClick: () => navigate(`${opsBase}/orders?orderId=${order.id}`),
                      }}
                      expanded
                    />
                    <div className="bd__mobile-revenue-meta">
                      <div>
                        <span>Invoiced</span>
                        <strong>{formatCurrency(order.invoiceAmount)}</strong>
                      </div>
                      <div>
                        <span>Received</span>
                        <strong>{formatCurrency(order.paidAmount)}</strong>
                      </div>
                      <div>
                        <span>Status</span>
                        <StatusBadge status={order.status} />
                      </div>
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
