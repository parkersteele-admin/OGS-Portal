/**
 * src/components/ui/CreateUserModal.tsx
 *
 * Shared modal for creating a new portal user with an assigned role.
 * Used from both the TopBar profile menu and the /admin/users page.
 */

import React, { useState, useEffect, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '../../lib/firebase'
import {
  createAppUser,
  type CreateUserInput,
} from '../../services/userService'
import { searchCustomers } from '../../services/customerService'
import { Button } from './Button'
import { Input } from './Input'
import { Modal } from './Modal'
import type { UserRole } from '../../types/user'
import type { Customer } from '../../types/customer'

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_ROLES: UserRole[] = ['admin', 'dispatch', 'driver', 'sales', 'customer']

const ROLE_LABELS: Record<UserRole, string> = {
  admin:    'Admin',
  dispatch: 'Dispatch',
  driver:   'Driver',
  sales:    'Sales',
  customer: 'Customer',
  owner:    'Owner',
  manager:  'Manager',
  billing:  'Billing',
  delivery: 'Delivery',
  viewer:   'Viewer',
}

// ── Customer typeahead ────────────────────────────────────────────────────────

interface CustomerSearchProps {
  selected: Customer | null
  onSelect: (c: Customer | null) => void
}

const CustomerSearch: React.FC<CustomerSearchProps> = ({ selected, onSelect }) => {
  const [term,    setTerm]    = useState('')
  const [results, setResults] = useState<Customer[]>([])
  const [open,    setOpen]    = useState(false)
  const timerRef     = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleInput = (value: string) => {
    setTerm(value)
    setOpen(true)
    clearTimeout(timerRef.current)
    if (value.length < 2) { setResults([]); return }
    timerRef.current = setTimeout(async () => {
      const res = await searchCustomers(value)
      setResults(res.slice(0, 8))
    }, 250)
  }

  const handleSelect = (c: Customer) => {
    onSelect(c)
    setTerm(c.name)
    setOpen(false)
    setResults([])
  }

  const handleClear = () => {
    onSelect(null)
    setTerm('')
    setResults([])
  }

  if (selected) {
    return (
      <div className="cum-customer-chip">
        <div className="cum-customer-chip__info">
          <span className="cum-customer-chip__name">{selected.name}</span>
          <span className="cum-customer-chip__email">{selected.email}</span>
        </div>
        <button type="button" className="cum-customer-chip__clear" onClick={handleClear} aria-label="Remove">
          ✕
        </button>
      </div>
    )
  }

  return (
    <div className="cum-typeahead" ref={containerRef}>
      <div className="ui-field">
        <label className="ui-field__label">
          Link to Customer Record <span className="cum-optional">(optional)</span>
        </label>
        <input
          className="ui-input"
          type="search"
          placeholder="Search by name or email…"
          value={term}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => term.length >= 2 && setOpen(true)}
          autoComplete="off"
        />
      </div>
      {open && results.length > 0 && (
        <ul className="cum-typeahead__dropdown" role="listbox">
          {results.map((c) => (
            <li
              key={c.id}
              className="cum-typeahead__item"
              role="option"
              aria-selected={false}
              onMouseDown={() => handleSelect(c)}
            >
              <span className="cum-typeahead__item-name">{c.name}</span>
              <span className="cum-typeahead__item-sub">{c.email}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── CreateUserModal ───────────────────────────────────────────────────────────

export interface CreateUserModalProps {
  onClose:             () => void
  onCreated:           () => void
  /** Restrict the role dropdown to these roles only. Defaults to all roles. */
  allowedRoles?:       UserRole[]
  /** Pre-link the new user to this customer record (hides the company search). */
  preselectedCustomer?: Customer
}

export const CreateUserModal: React.FC<CreateUserModalProps> = ({
  onClose,
  onCreated,
  allowedRoles,
  preselectedCustomer,
}) => {
  const roles = allowedRoles ?? ALL_ROLES
  const [name,     setName]     = useState('')
  const [email,    setEmail]    = useState('')
  const [role,     setRole]     = useState<UserRole>(roles[0] ?? 'driver')
  const [customer, setCustomer] = useState<Customer | null>(preselectedCustomer ?? null)
  const [error,    setError]    = useState('')
  const [success,  setSuccess]  = useState(false)

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: CreateUserInput = {
        name:  name.trim(),
        email: email.trim().toLowerCase(),
        role,
        customerId: role === 'customer' ? customer?.id : undefined,
      }
      const uid = await createAppUser(payload)

      // Send password-setup email (belt-and-suspenders; CF may already send it)
      try {
        await sendPasswordResetEmail(auth, payload.email)
      } catch {
        console.warn('[CreateUserModal] sendPasswordResetEmail: CF may have already sent it')
      }

      return uid
    },
    onSuccess: () => {
      setSuccess(true)
      setTimeout(() => {
        onCreated()
      }, 1200)
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to create user. Please try again.')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!name.trim())  { setError('Full name is required.'); return }
    if (!email.trim()) { setError('Email address is required.'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.')
      return
    }
    mutation.mutate()
  }

  return (
    <Modal open onClose={onClose} title="Create User" size="md">
      {success ? (
        <div className="cum-success">
          <p className="cum-success__icon">✓</p>
          <p className="cum-success__msg">User created! Password-setup email sent.</p>
        </div>
      ) : (
        <form className="cum-form" onSubmit={handleSubmit} noValidate>
          <Input
            label="Full Name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Smith"
            autoFocus
            required
          />
          <Input
            label="Email Address"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@example.com"
            required
          />

          <div className="ui-field">
            <label className="ui-field__label">Role</label>
            <select
              className="cum-select"
              value={role}
              onChange={(e) => {
                setRole(e.target.value as UserRole)
                if (e.target.value !== 'customer') setCustomer(preselectedCustomer ?? null)
              }}
            >
              {roles.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
            <div className="cum-role-descriptions">
              {role === 'admin'    && <p className="cum-role-desc">Full access — user management, settings, all modules.</p>}
              {role === 'dispatch' && <p className="cum-role-desc">Operations access — orders, runs, dispatch board.</p>}
              {role === 'driver'   && <p className="cum-role-desc">Driver app — assigned runs and delivery confirmations.</p>}
              {role === 'sales'    && <p className="cum-role-desc">CRM access — customers, leads, quotes, billing.</p>}
              {role === 'customer' && <p className="cum-role-desc">Customer portal — orders, invoices, tank levels.</p>}
            </div>
          </div>

          {role === 'customer' && !preselectedCustomer && (
            <CustomerSearch selected={customer} onSelect={setCustomer} />
          )}
          {role === 'customer' && preselectedCustomer && (
            <div className="cum-customer-chip">
              <div className="cum-customer-chip__info">
                <span className="cum-customer-chip__name">{preselectedCustomer.name}</span>
                <span className="cum-customer-chip__email">{preselectedCustomer.email}</span>
              </div>
            </div>
          )}

          <p className="cum-form__hint">
            A password-setup email will be sent automatically. The user sets their own password on first sign-in.
          </p>

          {error && (
            <p className="cum-form__error" role="alert">{error}</p>
          )}

          <div className="cum-form__actions">
            <Button type="button" variant="ghost" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={mutation.isPending}>
              Create User
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
