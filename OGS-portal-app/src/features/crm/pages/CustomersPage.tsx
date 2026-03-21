/**
 * src/pages/crm/CustomersPage.tsx
 *
 * CRM customer list with search, status filter, and add-customer modal.
 * Route: /crm/customers
 */

import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  subscribeToCustomers,
  createCustomer,
  type CreateCustomerInput,
} from '../../../services/customerService'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { Input } from '../../../components/ui/Input'
import { Modal } from '../../../components/ui/Modal'
import type { Customer, CustomerStatus } from '../../../types/customer'
import './CustomersPage.css'

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<CustomerStatus, 'success' | 'warning' | 'danger'> = {
  active:   'success',
  hold:     'warning',
  inactive: 'danger',
}

// ── Add-customer modal ────────────────────────────────────────────────────────

interface AddCustomerModalProps {
  onClose: () => void
  onCreated: (id: string) => void
}

const EMPTY_FORM: CreateCustomerInput = {
  name: '', email: '', phone: '',
  address: '', city: '', state: 'OH', zip: '',
  creditLimit: 5000, notes: '',
}

const AddCustomerModal: React.FC<AddCustomerModalProps> = ({ onClose, onCreated }) => {
  const [form, setForm]       = useState<CreateCustomerInput>(EMPTY_FORM)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  function set(field: keyof CreateCustomerInput, val: string | number) {
    setForm((f) => ({ ...f, [field]: val }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Company name is required.'); return }
    setSaving(true)
    setError('')
    try {
      const id = await createCustomer(form)
      onCreated(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create customer.')
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Add Customer" size="lg">
      <form className="cp-modal-form" onSubmit={handleSubmit}>
        <div className="cp-modal-form__section">
          <p className="cp-modal-form__section-label">Company</p>
          <div className="cp-modal-form__grid cp-modal-form__grid--1">
            <Input
              autoFocus
              label="Company Name *"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Nocterra Brewing"
            />
          </div>
        </div>

        <div className="cp-modal-form__section">
          <p className="cp-modal-form__section-label">Contact</p>
          <div className="cp-modal-form__grid cp-modal-form__grid--2">
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              placeholder="billing@company.com"
            />
            <Input
              label="Phone"
              type="tel"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="(614) 555-0100"
            />
          </div>
        </div>

        <div className="cp-modal-form__section">
          <p className="cp-modal-form__section-label">Address</p>
          <div className="cp-modal-form__grid cp-modal-form__grid--1">
            <Input
              label="Street"
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
              placeholder="123 Main St"
            />
          </div>
          <div className="cp-modal-form__grid cp-modal-form__grid--3">
            <Input
              label="City"
              value={form.city}
              onChange={(e) => set('city', e.target.value)}
              placeholder="Columbus"
            />
            <Input
              label="State"
              value={form.state}
              onChange={(e) => set('state', e.target.value)}
              placeholder="OH"
            />
            <Input
              label="ZIP"
              value={form.zip}
              onChange={(e) => set('zip', e.target.value)}
              placeholder="43215"
            />
          </div>
        </div>

        <div className="cp-modal-form__section">
          <p className="cp-modal-form__section-label">Account</p>
          <div className="cp-modal-form__grid cp-modal-form__grid--2">
            <Input
              label="Credit Limit ($)"
              type="number"
              value={String(form.creditLimit ?? 5000)}
              onChange={(e) => set('creditLimit', Number(e.target.value))}
            />
          </div>
          <label className="cp-modal-form__label" htmlFor="customer-notes">
            Notes
          </label>
          <textarea
            id="customer-notes"
            className="cp-modal-form__textarea"
            rows={3}
            value={form.notes ?? ''}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Internal notes"
          />
        </div>

        {error && <p className="cp-modal-form__error">{error}</p>}

        <div className="cp-modal-form__actions">
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Create Customer'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const CustomersPage: React.FC = () => {
  const navigate                        = useNavigate()
  const [customers, setCustomers]       = useState<Customer[]>([])
  const [loading, setLoading]           = useState(true)
  const [search, setSearch]             = useState('')
  const [statusFilter, setStatusFilter] = useState<CustomerStatus | 'All'>('All')
  const [showAdd, setShowAdd]           = useState(false)

  useEffect(() => {
    setLoading(true)
    const unsub = subscribeToCustomers({}, (cs) => {
      setCustomers(cs)
      setLoading(false)
    })
    return unsub
  }, [])

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
    navigate(`/crm/customers/${id}`)
  }, [navigate])

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
            {(['All', 'active', 'hold', 'inactive'] as const).map((s) => (
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
          <div className="page-table-wrap">
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
                    onClick={() => navigate(`/crm/customers/${c.id}`)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(`/crm/customers/${c.id}`)}
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
        )}
      </Card>

      {showAdd && (
        <AddCustomerModal
          onClose={() => setShowAdd(false)}
          onCreated={handleCreated}
        />
      )}

    </div>
  )
}

export default CustomersPage

