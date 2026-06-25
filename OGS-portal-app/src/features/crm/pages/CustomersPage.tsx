/**
 * src/pages/crm/CustomersPage.tsx
 *
 * CRM customer list with search, status filter, and add-customer modal.
 * Route: /crm/customers
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { getDocs, orderBy, query } from 'firebase/firestore'
import {
  subscribeToCustomers,
} from '../../../services/customerService'
import { ordersCol } from '../../../lib/firestore'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { Input } from '../../../components/ui/Input'
import CustomerCreateModal from '../components/CustomerCreateModal'
import type { Customer, CustomerStatus } from '../../../types/customer'
import type { Order } from '../../../types/order'
import { formatDate } from '../../../utils/format'
import './CustomersPage.css'

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<CustomerStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  active:   'success',
  hold:     'warning',
  inactive: 'danger',
  archived: 'neutral',
  deleted:  'neutral',
}

// ── Main page ─────────────────────────────────────────────────────────────────

const CustomersPage: React.FC = () => {
  const navigate                        = useNavigate()
  const location                        = useLocation()
  const crmBase                         = location.pathname.startsWith('/admin') ? '/admin/crm' : '/crm'
  const [customers, setCustomers]       = useState<Customer[]>([])
  const [loading, setLoading]           = useState(true)
  const [search, setSearch]             = useState('')
  const [statusFilter, setStatusFilter] = useState<CustomerStatus | 'All'>('All')
  const [showAdd, setShowAdd]           = useState(false)
  const [lastOrderMap, setLastOrderMap] = useState<Record<string, string>>({})

  useEffect(() => {
    const unsub = subscribeToCustomers({}, (cs) => {
      // Exclude hard-deleted documents from the customer list — they are only
      // visible on the individual CustomerRecord page during the 30-day grace window.
      setCustomers(cs.filter((c) => c.status !== 'deleted'))
      setLoading(false)
    })
    return unsub
  }, [])

  useEffect(() => {
    void (async () => {
      const snap = await getDocs(query(ordersCol, orderBy('requestedAt', 'desc')))
      const map: Record<string, string> = {}
      snap.docs.forEach((doc) => {
        const order = { ...doc.data(), id: doc.id } as Order
        if (!map[order.customerId]) {
          map[order.customerId] = formatDate(order.requestedAt ?? order.createdAt)
        }
      })
      setLastOrderMap(map)
    })()
  }, [])

  useEffect(() => {
    const shouldOpenCreate = new URLSearchParams(location.search).get('new') === '1'
    if (!shouldOpenCreate) return

    setShowAdd(true)
    navigate(location.pathname, { replace: true })
  }, [location.pathname, location.search, navigate])

  const getAccountType = useMemo(
    () => (customer: Customer) => {
      const notes = (customer.notes ?? '').toLowerCase()
      if (notes.includes('residential')) return 'Residential'
      if (notes.includes('industrial')) return 'Industrial'
      return 'Commercial'
    },
    [],
  )

  const filtered = customers.filter((c) => {
    if (statusFilter !== 'All' && c.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.city?.toLowerCase().includes(q) ||
        c.phone?.includes(q)
      )
    }
    return true
  })

  const handleCreated = useCallback((id: string) => {
    setShowAdd(false)
    navigate(`${crmBase}/customers/${id}`)
  }, [navigate, crmBase])

  return (
    <div className="cp-page page-layout">
      <header className="page-header">
        <div className="page-header__hero">
          <div className="page-header__title-section">
            <p className="page-header__eyebrow">Revenue Operations</p>
            <h1 className="page-header__title">Customers</h1>
            <p className="page-header__description">
              Maintain customer accounts, status, and profile details for CRM execution.
            </p>
          </div>
          <div className="page-header__actions">
            <Button variant="primary" onClick={() => setShowAdd(true)}>Add Customer</Button>
          </div>
        </div>
      </header>

      <Card className="cp-filters page-filters">
        <div className="page-filters__header">
          <div>
            <h2 className="page-filters__title">Filters</h2>
          </div>
          <div className="cp-filter-pills page-filters__presets">
            {(['All', 'active', 'hold', 'inactive', 'archived'] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={`page-filters__preset${statusFilter === s ? ' page-filters__preset--active' : ''}`}
                onClick={() => setStatusFilter(s)}
              >
                {s === 'All' ? 'All statuses' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="page-filters__grid">
          <Input
            className="cp-search"
            placeholder="Search company, email, city, or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search customers"
          />
        </div>
      </Card>

      <Card className="cp-table-card">
        <div className="cp-table-card__header">
          <h2 className="cp-table-card__title">Customer Directory</h2>
          <span className="cp-table-card__count">{filtered.length} {filtered.length === 1 ? 'customer' : 'customers'}</span>
        </div>

        {loading ? (
          <div className="page-empty cp-state">
            <h3 className="page-empty__title">Loading customers</h3>
          </div>
        ) : filtered.length === 0 ? (
          <div className="page-empty cp-state">
            <h3 className="page-empty__title">No customers found</h3>
            <p>
              {search || statusFilter !== 'All'
                ? 'No customers match the current filters.'
                : 'Add your first customer to start building your account base.'}
            </p>
          </div>
        ) : (
          <>
            <div className="page-table-wrap cp-table-wrap">
              <table className="page-table cp-table">
                <thead className="page-table__head">
                  <tr>
                    <th className="page-table__th">Company</th>
                    <th className="page-table__th">City</th>
                    <th className="page-table__th">Phone</th>
                    <th className="page-table__th">Email</th>
                    <th className="page-table__th">Status</th>
                    <th className="page-table__th page-table__th--right">Credit Limit</th>
                  </tr>
                </thead>
                <tbody className="page-table__tbody">
                  {filtered.map((c) => (
                    <tr
                      key={c.id}
                      className="page-table__tr cp-row"
                      onClick={() => navigate(`${crmBase}/customers/${c.id}`)}
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && navigate(`${crmBase}/customers/${c.id}`)}
                    >
                      <td className="page-table__td page-table__td--strong cp-cell--name">{c.name}</td>
                      <td className="page-table__td">{c.city}{c.state ? `, ${c.state}` : ''}</td>
                      <td className="page-table__td">{c.phone || '-'}</td>
                      <td className="page-table__td cp-cell--email">{c.email || '-'}</td>
                      <td className="page-table__td">
                        <Badge variant={STATUS_VARIANT[c.status] ?? 'neutral'}>
                          {c.status}
                        </Badge>
                      </td>
                      <td className="page-table__td page-table__td--right">
                        ${(c.creditLimit ?? 0).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="cp-mobile-cards">
              {filtered.map((c) => (
                <article
                  key={`mobile-${c.id}`}
                  className="cp-mobile-card"
                  onClick={() => navigate(`${crmBase}/customers/${c.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`${crmBase}/customers/${c.id}`)}
                >
                  <h3>{c.name}</h3>
                  <div className="cp-mobile-card__meta">{c.phone || 'No phone'} · {getAccountType(c)}</div>
                  <div className="cp-mobile-card__footer">
                    <span>Last order: {lastOrderMap[c.id] ?? '—'}</span>
                    <span className="cp-mobile-card__view">View →</span>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </Card>

      {showAdd && (
        <CustomerCreateModal
          open={showAdd}
          title="Add Customer"
          onClose={() => setShowAdd(false)}
          onCreated={handleCreated}
        />
      )}

    </div>
  )
}

export default CustomersPage

