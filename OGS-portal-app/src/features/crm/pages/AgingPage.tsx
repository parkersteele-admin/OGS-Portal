/**
 * src/features/crm/pages/AgingPage.tsx
 * BEM prefix: ag-
 *
 * Accounts Receivable Aging Report at /crm/aging.
 *
 * Groups unpaid/overdue invoices by aging bucket:
 *   Current (not yet due), 1–30 days, 31–60 days, 61–90 days, 90+ days
 *
 * Features:
 *   - Summary cards per aging bucket (count + total $)
 *   - Table of all open invoices with customer, invoice #, issued date, due date,
 *     days overdue, and total — sorted worst overdue first
 *   - Per-row actions: view PDF, mark paid, void
 *   - Search by customer name or invoice #
 *   - CSV export
 */

import { useState, useEffect, useMemo } from 'react'
import {
  onSnapshot,
  query,
  where,
  orderBy,
  getDoc,
  doc,
} from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import { invoicesCol } from '../../../lib/firestore'
import { markInvoicePaid, voidInvoice } from '../../../services/invoiceService'
import { Button } from '../../../components/ui/Button'
import type { Invoice } from '../../../types/billing'
import type { Customer } from '../../../types/customer'
import './AgingPage.css'

// ── Types ──────────────────────────────────────────────────────────────────────

type AgingBucket = 'current' | '1-30' | '31-60' | '61-90' | '90+'

const BUCKETS: AgingBucket[] = ['current', '1-30', '31-60', '61-90', '90+']

const BUCKET_LABELS: Record<AgingBucket, string> = {
  current:  'Current',
  '1-30':   '1–30 Days',
  '31-60':  '31–60 Days',
  '61-90':  '61–90 Days',
  '90+':    '90+ Days',
}

const BUCKET_COLORS: Record<AgingBucket, string> = {
  current:  'var(--color-brand)',
  '1-30':   '#f59e0b',
  '31-60':  '#ef4444',
  '61-90':  '#dc2626',
  '90+':    '#991b1b',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(n)
}

function fmtDate(ts: { toDate?: () => Date } | null | undefined): string {
  if (!ts?.toDate) return '—'
  return ts.toDate().toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function getDaysOverdue(dueAt: { toDate?: () => Date } | null | undefined): number {
  if (!dueAt?.toDate) return 0
  const due = dueAt.toDate()
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const diff = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24))
  return diff
}

function getBucket(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return 'current'
  if (daysOverdue <= 30) return '1-30'
  if (daysOverdue <= 60) return '31-60'
  if (daysOverdue <= 90) return '61-90'
  return '90+'
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function AgingPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [customerMap, setCustomerMap] = useState<Record<string, Customer>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeBucket, setActiveBucket] = useState<AgingBucket | 'all'>('all')
  const [actioning, setActioning] = useState<string | null>(null)

  // Subscribe to all open invoices (not paid, not void)
  useEffect(() => {
    const unsub = onSnapshot(
      query(
        invoicesCol,
        where('status', 'in', ['sent', 'overdue', 'draft']),
        orderBy('dueAt', 'asc'),
      ),
      (snap) => {
        setInvoices(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Invoice))
        setLoading(false)
      },
    )
    return unsub
  }, [])

  // Batch-load customer names as new invoices arrive
  useEffect(() => {
    const newIds = [...new Set(invoices.map((i) => i.customerId))]
      .filter((id) => !customerMap[id])
    if (!newIds.length) return
    Promise.all(
      newIds.map((id) =>
        getDoc(doc(db, 'customers', id)).then((s) =>
          s.exists() ? ({ id: s.id, ...s.data() } as Customer) : null,
        ),
      ),
    ).then((docs) => {
      const map: Record<string, Customer> = {}
      docs.forEach((c) => { if (c) map[c.id] = c })
      setCustomerMap((prev) => ({ ...prev, ...map }))
    })
  }, [invoices]) // eslint-disable-line react-hooks/exhaustive-deps

  // Enrich with days overdue and bucket
  const enriched = useMemo(() => {
    return invoices.map((inv) => {
      const days = getDaysOverdue(inv.dueAt)
      return { ...inv, daysOverdue: days, bucket: getBucket(days) }
    })
  }, [invoices])

  // Bucket summary stats
  const bucketStats = useMemo(() => {
    const stats: Record<AgingBucket, { count: number; total: number }> = {
      current: { count: 0, total: 0 },
      '1-30':  { count: 0, total: 0 },
      '31-60': { count: 0, total: 0 },
      '61-90': { count: 0, total: 0 },
      '90+':   { count: 0, total: 0 },
    }
    enriched.forEach((inv) => {
      stats[inv.bucket].count++
      stats[inv.bucket].total += inv.total
    })
    return stats
  }, [enriched])

  const grandTotal = useMemo(() =>
    enriched.reduce((sum, i) => sum + i.total, 0),
  [enriched])

  // Filtered list
  const filtered = useMemo(() => {
    let result = enriched
    if (activeBucket !== 'all') result = result.filter((i) => i.bucket === activeBucket)
    if (search.trim()) {
      const lc = search.toLowerCase()
      result = result.filter(
        (i) =>
          i.invoiceNumber.toLowerCase().includes(lc) ||
          customerMap[i.customerId]?.name.toLowerCase().includes(lc),
      )
    }
    // Worst overdue first
    return [...result].sort((a, b) => b.daysOverdue - a.daysOverdue)
  }, [enriched, activeBucket, search, customerMap])

  async function handleMarkPaid(id: string) {
    if (!confirm('Mark this invoice as paid?')) return
    setActioning(id)
    try {
      await markInvoicePaid(id)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to mark paid.')
    } finally {
      setActioning(null)
    }
  }

  async function handleVoid(id: string) {
    if (!confirm('Void this invoice? This cannot be undone.')) return
    setActioning(id)
    try {
      await voidInvoice(id)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to void invoice.')
    } finally {
      setActioning(null)
    }
  }

  function handleExportCsv() {
    const rows = [
      ['Invoice #', 'Customer', 'Issued', 'Due', 'Days Overdue', 'Total', 'Status'],
      ...filtered.map((i) => [
        i.invoiceNumber,
        customerMap[i.customerId]?.name ?? i.customerId,
        fmtDate(i.issuedAt),
        fmtDate(i.dueAt),
        i.daysOverdue > 0 ? String(i.daysOverdue) : 'Current',
        i.total.toFixed(2),
        i.status,
      ]),
    ]
    const csv = rows.map((r) => r.map((v) => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aging-report-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="ag-page">
      {/* Header */}
      <div className="ag-header">
        <div className="ag-header__left">
          <h1 className="ag-header__title">AR Aging Report</h1>
          {!loading && (
            <span className="ag-header__meta">
              {enriched.length} open invoice{enriched.length !== 1 ? 's' : ''} &mdash; {fmtCurrency(grandTotal)} outstanding
            </span>
          )}
        </div>
        <div className="ag-header__actions">
          <Button variant="secondary" size="sm" onClick={handleExportCsv} disabled={filtered.length === 0}>
            Export CSV
          </Button>
        </div>
      </div>

      {/* Bucket summary cards */}
      <div className="ag-buckets">
        {BUCKETS.map((bucket) => {
          const s = bucketStats[bucket]
          const isActive = activeBucket === bucket
          return (
            <button
              key={bucket}
              className={`ag-bucket-card ${isActive ? 'ag-bucket-card--active' : ''}`}
              style={{ '--bucket-color': BUCKET_COLORS[bucket] } as React.CSSProperties}
              onClick={() => setActiveBucket(isActive ? 'all' : bucket)}
              aria-pressed={isActive}
            >
              <div className="ag-bucket-card__label">{BUCKET_LABELS[bucket]}</div>
              <div className="ag-bucket-card__total">{fmtCurrency(s.total)}</div>
              <div className="ag-bucket-card__count">{s.count} invoice{s.count !== 1 ? 's' : ''}</div>
              <div className="ag-bucket-card__bar">
                <div
                  className="ag-bucket-card__bar-fill"
                  style={{
                    width: grandTotal > 0 ? `${Math.min(100, (s.total / grandTotal) * 100)}%` : '0%',
                  }}
                />
              </div>
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="ag-toolbar">
        <div className="ag-search">
          <svg className="ag-search__icon" width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" />
            <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            className="ag-search__input"
            placeholder="Search customer or invoice #…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="ag-search__clear" onClick={() => setSearch('')} aria-label="Clear">✕</button>
          )}
        </div>
        {activeBucket !== 'all' && (
          <button className="ag-filter-pill" onClick={() => setActiveBucket('all')}>
            {BUCKET_LABELS[activeBucket]} ✕
          </button>
        )}
      </div>

      {/* Table */}
      <div className="ag-table-wrap">
        {loading ? (
          <div className="ag-empty">Loading invoices…</div>
        ) : filtered.length === 0 ? (
          <div className="ag-empty">
            {enriched.length === 0
              ? 'No open invoices. All accounts are current.'
              : 'No invoices match the current filter.'}
          </div>
        ) : (
          <table className="ag-table">
            <thead>
              <tr>
                <th className="ag-th">Invoice #</th>
                <th className="ag-th">Customer</th>
                <th className="ag-th">Issued</th>
                <th className="ag-th">Due</th>
                <th className="ag-th">Days Overdue</th>
                <th className="ag-th">Status</th>
                <th className="ag-th ag-th--right">Total</th>
                <th className="ag-th ag-th--actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => (
                <tr
                  key={inv.id}
                  className={`ag-row ag-row--${inv.bucket}`}
                >
                  <td className="ag-td">
                    <span className="ag-inv-num">{inv.invoiceNumber}</span>
                  </td>
                  <td className="ag-td">
                    {customerMap[inv.customerId]?.name ?? '—'}
                  </td>
                  <td className="ag-td ag-td--date">{fmtDate(inv.issuedAt)}</td>
                  <td className="ag-td ag-td--date">{fmtDate(inv.dueAt)}</td>
                  <td className="ag-td">
                    {inv.daysOverdue > 0 ? (
                      <span className={`ag-overdue ag-overdue--${inv.bucket}`}>
                        {inv.daysOverdue}d overdue
                      </span>
                    ) : (
                      <span className="ag-current">Current</span>
                    )}
                  </td>
                  <td className="ag-td">
                    <span className={`ag-status ag-status--${inv.status}`}>
                      {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                    </span>
                  </td>
                  <td className="ag-td ag-td--right ag-total">
                    {fmtCurrency(inv.total)}
                  </td>
                  <td className="ag-td ag-td--actions">
                    {inv.pdfUrl && (
                      <a
                        href={inv.pdfUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="ag-action-btn"
                        title="View PDF"
                        aria-label="View PDF"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                          <polyline points="14 2 14 8 20 8" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                        </svg>
                      </a>
                    )}
                    <button
                      className="ag-action-btn ag-action-btn--success"
                      title="Mark paid"
                      aria-label="Mark paid"
                      disabled={actioning === inv.id}
                      onClick={() => handleMarkPaid(inv.id)}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                        <polyline points="20 6 9 17 4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button
                      className="ag-action-btn ag-action-btn--danger"
                      title="Void invoice"
                      aria-label="Void invoice"
                      disabled={actioning === inv.id}
                      onClick={() => handleVoid(inv.id)}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                        <path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="ag-foot-row">
                <td className="ag-td" colSpan={6}>
                  <strong>Total Outstanding</strong>
                </td>
                <td className="ag-td ag-td--right ag-total ag-total--grand">
                  <strong>{fmtCurrency(filtered.reduce((s, i) => s + i.total, 0))}</strong>
                </td>
                <td className="ag-td" />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  )
}
