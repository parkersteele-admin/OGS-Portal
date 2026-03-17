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
} from '../../services/customerService'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import type { Customer, CustomerStatus } from '../../types/customer'
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
    <div className="cp-modal-backdrop" onClick={onClose}>
      <div className="cp-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Add customer">
        <div className="cp-modal__header">
          <h2 className="cp-modal__title">Add Customer</h2>
          <button className="cp-modal__close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form className="cp-modal__form" onSubmit={handleSubmit}>
          <div className="cp-modal__section-label">Company</div>
          <div className="cp-modal__grid cp-modal__grid--1">
            <Input autoFocus label="Company Name *" value={form.name}
              onChange={(e) => set('name', e.target.value)} placeholder="e.g. Nocterra Brewing" />
          </div>

          <div className="cp-modal__section-label">Contact</div>
          <div className="cp-modal__grid cp-modal__grid--2">
            <Input label="Email" type="email" value={form.email}
              onChange={(e) => set('email', e.target.value)} placeholder="billing@company.com" />
            <Input label="Phone" type="tel" value={form.phone}
              onChange={(e) => set('phone', e.target.value)} placeholder="(614) 555-0100" />
          </div>

          <div className="cp-modal__section-label">Address</div>
          <div className="cp-modal__grid cp-modal__grid--1">
            <Input label="Street" value={form.address}
              onChange={(e) => set('address', e.target.value)} placeholder="123 Main St" />
          </div>
          <div className="cp-modal__grid cp-modal__grid--3">
            <Input label="City" value={form.city}
              onChange={(e) => set('city', e.target.value)} placeholder="Columbus" />
            <Input label="State" value={form.state}
              onChange={(e) => set('state', e.target.value)} placeholder="OH" />
            <Input label="ZIP" value={form.zip}
              onChange={(e) => set('zip', e.target.value)} placeholder="43215" />
          </div>

          <div className="cp-modal__section-label">Account</div>
          <div className="cp-modal__grid cp-modal__grid--2">
            <Input label="Credit Limit ($)" type="number" value={String(form.creditLimit ?? 5000)}
              onChange={(e) => set('creditLimit', Number(e.target.value))} />
            <div />
          </div>
          <div className="cp-modal__grid cp-modal__grid--1">
            <label className="cp-modal__label">
              Notes
              <textarea className="cp-modal__textarea" rows={2} value={form.notes ?? ''}
                onChange={(e) => set('notes', e.target.value)} placeholder="Internal notes…" />
            </label>
          </div>

          {error && <p className="cp-modal__error">{error}</p>}

          <div className="cp-modal__actions">
            <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Create Customer'}
            </Button>
          </div>
        </form>
      </div>
    </div>
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
    <div className="cp-page">
      {/* Header */}
      <div className="cp-header">
        <div className="cp-header__left">
          <h1 className="cp-title">Customers</h1>
          <span className="cp-count">{filtered.length} {filtered.length === 1 ? 'customer' : 'customers'}</span>
        </div>
        <div className="cp-header__right">
          <Button variant="primary" onClick={() => setShowAdd(true)}>+ Add Customer</Button>
        </div>
      </div>

      {/* Filters */}
      <div className="cp-filters">
        <Input
          className="cp-search"
          placeholder="Search name, email, city, phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="cp-filter-pills">
          {(['All', 'active', 'hold', 'inactive'] as const).map((s) => (
            <button
              key={s}
              className={`cp-pill${statusFilter === s ? ' cp-pill--active' : ''}`}
              onClick={() => setStatusFilter(s)}
            >
              {s === 'All' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="cp-loading">Loading customers…</div>
      ) : filtered.length === 0 ? (
        <div className="cp-empty">
          {search || statusFilter !== 'All'
            ? 'No customers match your filter.'
            : 'No customers yet. Click "+ Add Customer" to get started.'}
        </div>
      ) : (
        <div className="cp-table-wrap">
          <table className="cp-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>City</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Status</th>
                <th>Credit Limit</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  className="cp-row"
                  onClick={() => navigate(`/crm/customers/${c.id}`)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/crm/customers/${c.id}`)}
                >
                  <td className="cp-cell cp-cell--name">{c.name}</td>
                  <td className="cp-cell">{c.city}{c.state ? `, ${c.state}` : ''}</td>
                  <td className="cp-cell">{c.phone || '—'}</td>
                  <td className="cp-cell cp-cell--email">{c.email || '—'}</td>
                  <td className="cp-cell">
                    <Badge variant={STATUS_VARIANT[c.status] ?? 'neutral'}>
                      {c.status}
                    </Badge>
                  </td>
                  <td className="cp-cell cp-cell--right">
                    ${(c.creditLimit ?? 0).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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

