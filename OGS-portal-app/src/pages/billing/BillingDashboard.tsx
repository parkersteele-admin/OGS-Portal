/**
 * src/pages/billing/BillingDashboard.tsx
 *
 * Staff billing dashboard accessible at /ops/billing (admin/dispatch) and
 * /crm/billing (admin/sales).
 *
 * Features:
 *  - Date-range filter (start + end date inputs)
 *  - Summary metric cards (total revenue, collected, outstanding, avg invoice)
 *  - Aging report (5-bucket table)
 *  - Export controls: checkboxes for invoices / payments + "Export to CSV"
 *  - Shows row counts before download
 *  - Loading state while data is being fetched
 */

import React, { useState, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  getDocs,
  query,
  orderBy,
  where,
  Timestamp,
} from 'firebase/firestore'
import { invoicesCol, paymentsCol, customersCol } from '../../lib/firestore'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { formatCurrency } from '../../utils/format'
import { exportInvoicesToCsv, exportPaymentsToCsv } from '../../utils/exportUtils'
import { generateAgingReport, calculateRevenueMetrics } from '../../utils/reportUtils'
import type { Invoice, Payment } from '../../types/billing'
import type { Customer } from '../../types/customer'
import './BillingDashboard.css'

// ── Default date range: first day of current month → today ───────────────────
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function defaultRange(): { start: string; end: string } {
  const today = new Date()
  const first = new Date(today.getFullYear(), today.getMonth(), 1)
  return { start: isoDate(first), end: isoDate(today) }
}

// ── Fetch helpers (direct Firestore — we need all rows, not a paginated page) ─

async function fetchInvoicesInRange(start: Date, end: Date): Promise<Invoice[]> {
  const snap = await getDocs(
    query(
      invoicesCol,
      where('issuedAt', '>=', Timestamp.fromDate(start)),
      where('issuedAt', '<=', Timestamp.fromDate(end)),
      orderBy('issuedAt', 'desc'),
    ),
  )
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Invoice)
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

async function fetchAllCustomers(): Promise<Customer[]> {
  const snap = await getDocs(query(customersCol, orderBy('name')))
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Customer)
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface MetricCardProps {
  label:    string
  value:    string
  sub?:     string
  accent?:  boolean
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, sub, accent }) => (
  <Card className={`bd-metric${accent ? ' bd-metric--accent' : ''}`}>
    <p className="bd-metric__label">{label}</p>
    <p className="bd-metric__value">{value}</p>
    {sub && <p className="bd-metric__sub">{sub}</p>}
  </Card>
)

// ── Main component ────────────────────────────────────────────────────────────

export const BillingDashboard: React.FC = () => {
  const def = defaultRange()
  const [startDate, setStartDate] = useState(def.start)
  const [endDate,   setEndDate]   = useState(def.end)

  // Committed range — only updates when user clicks "Load Data"
  const [committed, setCommitted] = useState({ start: def.start, end: def.end })

  const [exportInvoices, setExportInvoices] = useState(true)
  const [exportPayments, setExportPayments] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Derived Date objects for queries
  const startDt = useMemo(() => {
    const d = new Date(committed.start)
    d.setHours(0, 0, 0, 0)
    return d
  }, [committed.start])

  const endDt = useMemo(() => {
    const d = new Date(committed.end)
    d.setHours(23, 59, 59, 999)
    return d
  }, [committed.end])

  const invoicesQuery = useQuery({
    queryKey:  ['billing-dashboard', 'invoices', committed.start, committed.end],
    queryFn:   () => fetchInvoicesInRange(startDt, endDt),
    staleTime: 2 * 60 * 1000,
  })

  const paymentsQuery = useQuery({
    queryKey:  ['billing-dashboard', 'payments', committed.start, committed.end],
    queryFn:   () => fetchPaymentsInRange(startDt, endDt),
    staleTime: 2 * 60 * 1000,
  })

  const customersQuery = useQuery({
    queryKey:  ['billing-dashboard', 'customers'],
    queryFn:   fetchAllCustomers,
    staleTime: 5 * 60 * 1000,
  })

  const invoices  = invoicesQuery.data  ?? []
  const payments  = paymentsQuery.data  ?? []
  const customers = customersQuery.data ?? []

  const isLoading = invoicesQuery.isPending || paymentsQuery.isPending || customersQuery.isPending
  const hasError  = invoicesQuery.isError  || paymentsQuery.isError

  // Computed reports
  const metrics = useMemo(
    () => calculateRevenueMetrics(invoices, payments),
    [invoices, payments],
  )

  const agingBuckets = useMemo(
    () => generateAgingReport(invoices),
    [invoices],
  )

  const handleLoad = useCallback(() => {
    if (!startDate || !endDate || startDate > endDate) return
    setCommitted({ start: startDate, end: endDate })
  }, [startDate, endDate])

  const handleExport = useCallback(async () => {
    setExporting(true)
    try {
      if (exportInvoices) exportInvoicesToCsv(invoices, customers)
      if (exportPayments) exportPaymentsToCsv(payments, customers, invoices)
    } finally {
      setExporting(false)
    }
  }, [exportInvoices, exportPayments, invoices, payments, customers])

  const exportCount =
    (exportInvoices ? invoices.length : 0) +
    (exportPayments ? payments.length : 0)

  const canExport = (exportInvoices || exportPayments) && exportCount > 0 && !isLoading

  return (
    <div className="bd">
      {/* ── Page heading ─────────────────────────────────────────────────── */}
      <div className="bd__header">
        <div>
          <h1 className="bd__title">Billing Dashboard</h1>
          <p className="bd__subtitle">Financial summary and QuickBooks-compatible CSV export</p>
        </div>
      </div>

      {/* ── Date range + Load ────────────────────────────────────────────── */}
      <Card className="bd__controls">
        <div className="bd__range">
          <Input
            label="Start Date"
            type="date"
            value={startDate}
            max={endDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <span className="bd__range-sep">to</span>
          <Input
            label="End Date"
            type="date"
            value={endDate}
            min={startDate}
            max={isoDate(new Date())}
            onChange={(e) => setEndDate(e.target.value)}
          />
          <Button
            variant="primary"
            onClick={handleLoad}
            disabled={!startDate || !endDate || startDate > endDate}
            className="bd__load-btn"
          >
            Load Data
          </Button>
        </div>

        {hasError && (
          <p className="bd__error" role="alert">
            Failed to load billing data. Please try again.
          </p>
        )}
      </Card>

      {/* ── Metric cards ────────────────────────────────────────────────── */}
      <div className="bd__metrics">
        <MetricCard
          label="Total Revenue"
          value={formatCurrency(metrics.totalRevenue)}
          sub={`${metrics.invoiceCount} invoice${metrics.invoiceCount !== 1 ? 's' : ''}`}
          accent
        />
        <MetricCard
          label="Collected"
          value={formatCurrency(metrics.collected)}
          sub={`${metrics.collectionRate}% collection rate`}
        />
        <MetricCard
          label="Outstanding"
          value={formatCurrency(metrics.outstanding)}
        />
        <MetricCard
          label="Avg Invoice"
          value={formatCurrency(metrics.averageInvoice)}
          sub={`${metrics.paymentCount} payment${metrics.paymentCount !== 1 ? 's' : ''}`}
        />
      </div>

      {/* ── Aging report ─────────────────────────────────────────────────── */}
      <Card className="bd__aging">
        <h2 className="bd__section-title">Accounts Receivable Aging</h2>

        {isLoading ? (
          <div className="bd__skeleton-rows">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bd__skeleton-row" />
            ))}
          </div>
        ) : (
          <div className="bd__aging-table-wrap">
            <table className="bd__aging-table">
              <thead>
                <tr>
                  <th>Age</th>
                  <th className="bd__col-num">Invoices</th>
                  <th className="bd__col-num">Amount</th>
                  <th className="bd__col-bar" aria-hidden="true"></th>
                </tr>
              </thead>
              <tbody>
                {agingBuckets.map((bucket) => {
                  const maxTotal  = Math.max(...agingBuckets.map((b) => b.total), 1)
                  const barWidth  = maxTotal > 0
                    ? Math.max(2, Math.round((bucket.total / maxTotal) * 100))
                    : 0

                  return (
                    <tr key={bucket.label} className={bucket.total > 0 ? '' : 'bd__aging-row--zero'}>
                      <td>{bucket.label}</td>
                      <td className="bd__col-num">{bucket.count}</td>
                      <td className="bd__col-num">{formatCurrency(bucket.total)}</td>
                      <td className="bd__col-bar">
                        <div
                          className="bd__aging-bar"
                          style={{ width: `${barWidth}%` }}
                          aria-hidden="true"
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td><strong>Total</strong></td>
                  <td className="bd__col-num">
                    <strong>{agingBuckets.reduce((s, b) => s + b.count, 0)}</strong>
                  </td>
                  <td className="bd__col-num">
                    <strong>
                      {formatCurrency(agingBuckets.reduce((s, b) => s + b.total, 0))}
                    </strong>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* ── Export controls ──────────────────────────────────────────────── */}
      <Card className="bd__export">
        <h2 className="bd__section-title">Export to CSV</h2>
        <p className="bd__export-hint">
          Downloads QuickBooks-compatible CSV files directly to your browser.
        </p>

        <div className="bd__export-options">
          <label className="bd__checkbox">
            <input
              type="checkbox"
              checked={exportInvoices}
              onChange={(e) => setExportInvoices(e.target.checked)}
            />
            <span>
              Export invoices
              {!isLoading && (
                <span className="bd__count"> ({invoices.length} row{invoices.length !== 1 ? 's' : ''})</span>
              )}
            </span>
          </label>

          <label className="bd__checkbox">
            <input
              type="checkbox"
              checked={exportPayments}
              onChange={(e) => setExportPayments(e.target.checked)}
            />
            <span>
              Export payments
              {!isLoading && (
                <span className="bd__count"> ({payments.length} row{payments.length !== 1 ? 's' : ''})</span>
              )}
            </span>
          </label>
        </div>

        <div className="bd__export-footer">
          {canExport && (
            <p className="bd__export-summary">
              Ready to export <strong>{exportCount}</strong> row{exportCount !== 1 ? 's' : ''}.
            </p>
          )}

          <Button
            variant="primary"
            onClick={handleExport}
            disabled={!canExport}
            loading={exporting}
          >
            Export to CSV
          </Button>
        </div>
      </Card>
    </div>
  )
}

export default BillingDashboard
