import React, { useState } from 'react'
import { createCustomer, type CreateCustomerInput } from '../../../services/customerService'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { Modal } from '../../../components/ui/Modal'
import './CustomerCreateModal.css'

interface CustomerCreateModalProps {
  open: boolean
  title?: string
  onClose: () => void
  onCreated: (id: string) => void | Promise<void>
}

const EMPTY_FORM: CreateCustomerInput = {
  name: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  state: 'OH',
  zip: '',
  creditLimit: 5000,
  notes: '',
}

const CustomerCreateModal: React.FC<CustomerCreateModalProps> = ({
  open,
  title = 'Add Customer',
  onClose,
  onCreated,
}) => {
  const [form, setForm] = useState<CreateCustomerInput>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const setField = (field: keyof CreateCustomerInput, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const resetForm = () => {
    setForm(EMPTY_FORM)
    setError('')
    setSaving(false)
  }

  const handleClose = () => {
    if (saving) return
    resetForm()
    onClose()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const trimmedName = form.name.trim()
    if (!trimmedName) {
      setError('Company name is required.')
      return
    }

    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError('Please enter a valid email address.')
      return
    }

    setSaving(true)
    setError('')

    try {
      const id = await createCustomer({
        ...form,
        name: trimmedName,
        email: form.email.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        zip: form.zip.trim(),
        notes: form.notes?.trim() ?? '',
      })
      await onCreated(id)
      resetForm()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create customer.')
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title={title} size="lg">
      <form className="crm-customer-modal" onSubmit={handleSubmit}>
        <div className="crm-customer-modal__section">
          <p className="crm-customer-modal__section-label">Company</p>
          <div className="crm-customer-modal__grid crm-customer-modal__grid--1">
            <Input
              autoFocus
              label="Company Name *"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="e.g. Nocterra Brewing"
            />
          </div>
        </div>

        <div className="crm-customer-modal__section">
          <p className="crm-customer-modal__section-label">Contact</p>
          <div className="crm-customer-modal__grid crm-customer-modal__grid--2">
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => setField('email', e.target.value)}
              placeholder="billing@company.com"
            />
            <Input
              label="Phone"
              type="tel"
              value={form.phone}
              onChange={(e) => setField('phone', e.target.value)}
              placeholder="(614) 555-0100"
            />
          </div>
        </div>

        <div className="crm-customer-modal__section">
          <p className="crm-customer-modal__section-label">Address</p>
          <div className="crm-customer-modal__grid crm-customer-modal__grid--1">
            <Input
              label="Street"
              value={form.address}
              onChange={(e) => setField('address', e.target.value)}
              placeholder="123 Main St"
            />
          </div>
          <div className="crm-customer-modal__grid crm-customer-modal__grid--3">
            <Input
              label="City"
              value={form.city}
              onChange={(e) => setField('city', e.target.value)}
              placeholder="Columbus"
            />
            <Input
              label="State"
              value={form.state}
              onChange={(e) => setField('state', e.target.value)}
              placeholder="OH"
            />
            <Input
              label="ZIP"
              value={form.zip}
              onChange={(e) => setField('zip', e.target.value)}
              placeholder="43215"
            />
          </div>
        </div>

        <div className="crm-customer-modal__section">
          <p className="crm-customer-modal__section-label">Account</p>
          <div className="crm-customer-modal__grid crm-customer-modal__grid--2">
            <Input
              label="Credit Limit ($)"
              type="number"
              min="0"
              value={String(form.creditLimit ?? 5000)}
              onChange={(e) => setField('creditLimit', Number(e.target.value) || 0)}
            />
          </div>
          <label className="crm-customer-modal__label" htmlFor="crm-customer-notes">
            Notes
          </label>
          <textarea
            id="crm-customer-notes"
            className="crm-customer-modal__textarea"
            rows={3}
            value={form.notes ?? ''}
            onChange={(e) => setField('notes', e.target.value)}
            placeholder="Internal notes"
          />
        </div>

        {error && <p className="crm-customer-modal__error">{error}</p>}

        <div className="crm-customer-modal__actions">
          <Button variant="ghost" type="button" onClick={handleClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Create Customer'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default CustomerCreateModal
