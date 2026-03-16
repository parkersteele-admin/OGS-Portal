/**
 * src/pages/admin/UserManagement.tsx
 *
 * Admin-only user management page at /admin/users.
 * Protected by ProtectedRoute role="admin" in the router.
 *
 * Sections:
 *  1. Stat cards — total count per role
 *  2. Filter bar — search + role filter
 *  3. User table — Name | Email | Role | Status | Last Login | Actions
 *  4. Create User modal — CF adminCreateUser + sendPasswordResetEmail
 *  5. Edit User modal  — change role (CF) + activate/deactivate (Firestore)
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getDocs, query, orderBy } from 'firebase/firestore'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '../../lib/firebase'
import { usersCol } from '../../lib/firestore'
import {
  assignUserRole,
  deactivateUser,
  reactivateUser,
  createAppUser,
  type CreateUserInput,
} from '../../services/userService'
import { searchCustomers } from '../../services/customerService'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import { formatDate } from '../../utils/format'
import type { AppUser } from '../../types/user'
import type { UserRole } from '../../types/user'
import type { Customer } from '../../types/customer'
import './UserManagement.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_ROLES: UserRole[] = ['admin', 'dispatch', 'driver', 'sales', 'customer']

const ROLE_LABELS: Record<UserRole, string> = {
  admin:    'Admin',
  dispatch: 'Dispatch',
  driver:   'Driver',
  sales:    'Sales',
  customer: 'Customer',
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchAllUsers(): Promise<AppUser[]> {
  const snap = await getDocs(query(usersCol, orderBy('name')))
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as AppUser)
}

// ── Role badge ────────────────────────────────────────────────────────────────

const RoleBadge: React.FC<{ role: UserRole }> = ({ role }) => (
  <span className={`um-role um-role--${role}`}>{ROLE_LABELS[role]}</span>
)

// ── Status dot ────────────────────────────────────────────────────────────────

const StatusDot: React.FC<{ active: boolean }> = ({ active }) => (
  <span className={`um-status um-status--${active ? 'active' : 'inactive'}`}>
    {active ? 'Active' : 'Inactive'}
  </span>
)

// ── Stat card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  role:  UserRole
  count: number
  total: number
}

const StatCard: React.FC<StatCardProps> = ({ role, count, total }) => (
  <div className={`um-stat um-stat--${role}`}>
    <p className="um-stat__count">{count}</p>
    <p className="um-stat__label">{ROLE_LABELS[role]}</p>
    {total > 0 && (
      <div className="um-stat__bar-track">
        <div
          className="um-stat__bar-fill"
          style={{ width: `${Math.round((count / total) * 100)}%` }}
        />
      </div>
    )}
  </div>
)

// ── Customer typeahead ────────────────────────────────────────────────────────

interface CustomerSearchProps {
  selected: Customer | null
  onSelect: (c: Customer | null) => void
}

const CustomerSearch: React.FC<CustomerSearchProps> = ({ selected, onSelect }) => {
  const [term,    setTerm]    = useState('')
  const [results, setResults] = useState<Customer[]>([])
  const [open,    setOpen]    = useState(false)
  const timerRef              = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const containerRef          = useRef<HTMLDivElement>(null)

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
      <div className="um-customer-chip">
        <div className="um-customer-chip__info">
          <span className="um-customer-chip__name">{selected.name}</span>
          <span className="um-customer-chip__email">{selected.email}</span>
        </div>
        <button type="button" className="um-customer-chip__clear" onClick={handleClear} aria-label="Remove">
          ✕
        </button>
      </div>
    )
  }

  return (
    <div className="um-typeahead" ref={containerRef}>
      <div className="ui-field">
        <label className="ui-field__label">Link to Customer Record <span className="um-optional">(optional)</span></label>
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
        <ul className="um-typeahead__dropdown" role="listbox">
          {results.map((c) => (
            <li
              key={c.id}
              className="um-typeahead__item"
              role="option"
              aria-selected={false}
              onMouseDown={() => handleSelect(c)}
            >
              <span className="um-typeahead__item-name">{c.name}</span>
              <span className="um-typeahead__item-sub">{c.email}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Create User Modal ─────────────────────────────────────────────────────────

interface CreateUserModalProps {
  onClose:   () => void
  onCreated: () => void
}

const CreateUserModal: React.FC<CreateUserModalProps> = ({ onClose, onCreated }) => {
  const [name,     setName]     = useState('')
  const [email,    setEmail]    = useState('')
  const [role,     setRole]     = useState<UserRole>('driver')
  const [customer, setCustomer] = useState<Customer | null>(null)
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

      // Send password-setup email. The CF may already do this; this is a
      // belt-and-suspenders call that fails silently if already sent.
      try {
        await sendPasswordResetEmail(auth, payload.email)
      } catch {
        console.warn('[UserManagement] sendPasswordResetEmail: CF may have already sent it')
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
        <div className="um-success">
          <p className="um-success__icon">✓</p>
          <p className="um-success__msg">User created! Password-setup email sent.</p>
        </div>
      ) : (
        <form className="um-form" onSubmit={handleSubmit} noValidate>
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
              className="um-select"
              value={role}
              onChange={(e) => {
                setRole(e.target.value as UserRole)
                if (e.target.value !== 'customer') setCustomer(null)
              }}
            >
              {ALL_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>

          {role === 'customer' && (
            <CustomerSearch selected={customer} onSelect={setCustomer} />
          )}

          <p className="um-form__hint">
            A password-setup email will be sent automatically. The user sets their own password on first sign-in.
          </p>

          {error && (
            <p className="um-form__error" role="alert">{error}</p>
          )}

          <div className="um-form__actions">
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

// ── Edit User Modal ───────────────────────────────────────────────────────────

interface EditUserModalProps {
  user:      AppUser
  onClose:   () => void
  onUpdated: () => void
}

const EditUserModal: React.FC<EditUserModalProps> = ({ user, onClose, onUpdated }) => {
  const [role,  setRole]  = useState<UserRole>(user.role)
  const [error, setError] = useState('')

  const roleChanged = role !== user.role

  const roleMutation = useMutation({
    mutationFn: () => assignUserRole(user.id, role),
    onSuccess:  () => { onUpdated() },
    onError:    (err: Error) => setError(err.message || 'Failed to update role.'),
  })

  const toggleMutation = useMutation({
    mutationFn: () => (user.active ? deactivateUser(user.id) : reactivateUser(user.id)),
    onSuccess:  () => { onUpdated() },
    onError:    (err: Error) => setError(err.message || 'Failed to update status.'),
  })

  return (
    <Modal open onClose={onClose} title={`Edit ${user.name}`} size="md">
      <div className="um-edit">

        {/* User info */}
        <div className="um-edit__info">
          <div className="um-edit__avatar">{user.name.charAt(0).toUpperCase()}</div>
          <div>
            <p className="um-edit__name">{user.name}</p>
            <p className="um-edit__email">{user.email}</p>
          </div>
          <div className="um-edit__current-badge">
            <RoleBadge role={user.role} />
          </div>
        </div>

        {/* Change role */}
        <section className="um-edit__section">
          <p className="um-edit__section-label">Change Role</p>
          <div className="um-edit__role-row">
            <select
              className="um-select"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
            >
              {ALL_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
            <Button
              variant="primary"
              size="sm"
              onClick={() => roleMutation.mutate()}
              disabled={!roleChanged}
              loading={roleMutation.isPending}
            >
              Update Role
            </Button>
          </div>
          <p className="um-edit__hint">
            Role changes update Firebase Auth custom claims via Cloud Function.
          </p>
        </section>

        {/* Linked customer record */}
        {user.customerId && (
          <section className="um-edit__section">
            <p className="um-edit__section-label">Linked Customer Record</p>
            <p className="um-edit__customer-id">{user.customerId}</p>
          </section>
        )}

        {/* Activate / Deactivate */}
        <section className="um-edit__section">
          <p className="um-edit__section-label">Account Status</p>
          <div className="um-edit__status-row">
            <StatusDot active={user.active} />
            <Button
              variant={user.active ? 'danger' : 'success'}
              size="sm"
              onClick={() => toggleMutation.mutate()}
              loading={toggleMutation.isPending}
            >
              {user.active ? 'Deactivate' : 'Reactivate'}
            </Button>
          </div>
          {!user.active && (
            <p className="um-edit__deactivated-note">
              Deactivated users are blocked from signing in.
            </p>
          )}
        </section>

        {error && <p className="um-form__error" role="alert">{error}</p>}

        <div className="um-form__actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

      </div>
    </Modal>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export const UserManagement: React.FC = () => {
  const queryClient = useQueryClient()

  const [searchTerm, setSearchTerm] = useState('')
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [editUser,   setEditUser]   = useState<AppUser | null>(null)

  const usersQuery = useQuery({
    queryKey:  ['admin', 'users'],
    queryFn:   fetchAllUsers,
    staleTime: 60 * 1000,
  })

  const users     = usersQuery.data  ?? []
  const isLoading = usersQuery.isPending
  const hasError  = usersQuery.isError

  // ── Stats ────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const counts: Record<UserRole, number> = { admin: 0, dispatch: 0, driver: 0, sales: 0, customer: 0 }
    for (const u of users) {
      if (u.role in counts) counts[u.role]++
    }
    return counts
  }, [users])

  const totalUsers = users.length

  // ── Filtered table ────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return users.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false
      if (searchTerm) {
        const lower = searchTerm.toLowerCase()
        if (!u.name.toLowerCase().includes(lower) && !u.email.toLowerCase().includes(lower)) return false
      }
      return true
    })
  }, [users, roleFilter, searchTerm])

  const handleCreated = useCallback(() => {
    setCreateOpen(false)
    queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
  }, [queryClient])

  const handleUpdated = useCallback(() => {
    setEditUser(null)
    queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
  }, [queryClient])

  const lastLoginOf = (user: AppUser): string => {
    const ext = user as AppUser & { lastLoginAt?: { toDate(): Date } }
    return ext.lastLoginAt ? formatDate(ext.lastLoginAt) : '—'
  }

  return (
    <div className="um">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="um__header">
        <div>
          <h1 className="um__title">User Management</h1>
          <p className="um__subtitle">
            {totalUsers} portal account{totalUsers !== 1 ? 's' : ''}
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          + Create User
        </Button>
      </div>

      {/* ── 1. Stat cards ────────────────────────────────────────────── */}
      <div className="um__stats">
        {ALL_ROLES.map((r) => (
          <StatCard key={r} role={r} count={stats[r]} total={totalUsers} />
        ))}
      </div>

      {/* ── 2. Filter bar ────────────────────────────────────────────── */}
      <div className="um__filters">
        <input
          type="search"
          className="um__search"
          placeholder="Search name or email…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          aria-label="Search users"
        />
        <select
          className="um__role-filter"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as UserRole | 'all')}
          aria-label="Filter by role"
        >
          <option value="all">All roles</option>
          {ALL_ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
        <span className="um__result-count">
          {filtered.length} user{filtered.length !== 1 ? 's' : ''}
        </span>
        {(searchTerm || roleFilter !== 'all') && (
          <button
            type="button"
            className="um__filter-clear"
            onClick={() => { setSearchTerm(''); setRoleFilter('all') }}
          >
            Clear
          </button>
        )}
      </div>

      {/* ── 3. User table ────────────────────────────────────────────── */}
      <div className="um__table-card">
        {hasError ? (
          <p className="um__empty" role="alert">Failed to load users. Please refresh.</p>
        ) : isLoading ? (
          <div className="um__skeleton-rows">
            {[...Array(6)].map((_, i) => <div key={i} className="um__skeleton-row" />)}
          </div>
        ) : filtered.length === 0 ? (
          <p className="um__empty">No users match the current filters.</p>
        ) : (
          <div className="um__table-wrap">
            <table className="um__table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last Login</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => (
                  <tr key={user.id} className={!user.active ? 'um__row--inactive' : ''}>
                    <td className="um__cell-name">
                      <span className="um__avatar" aria-hidden="true">
                        {user.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="um__cell-name-text">
                        {user.name}
                        {user.customerId && (
                          <span className="um__linked-icon" title="Linked to customer record">⊙</span>
                        )}
                      </span>
                    </td>
                    <td className="um__cell-email">{user.email}</td>
                    <td><RoleBadge role={user.role} /></td>
                    <td><StatusDot active={user.active} /></td>
                    <td className="um__cell-date">{lastLoginOf(user)}</td>
                    <td>
                      <button
                        type="button"
                        className="um__action-btn"
                        onClick={() => setEditUser(user)}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Modals ───────────────────────────────────────────────────── */}
      {createOpen && (
        <CreateUserModal
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
      )}

      {editUser && (
        <EditUserModal
          user={editUser}
          onClose={() => setEditUser(null)}
          onUpdated={handleUpdated}
        />
      )}

    </div>
  )
}

export default UserManagement
