/**
 * src/pages/admin/UserManagement.tsx
 *
 * Admin-only user management page at /admin/users.
 * Protected by ProtectedRoute role="admin" in the router.
 *
 * Shows OGS staff only (admin, dispatch, driver, sales).
 * Customer user access is managed from each customer's profile page.
 *
 * Sections:
 *  1. Stat cards — count per OGS role
 *  2. Filter bar — search + role filter
 *  3. User table — Name | Email | Role | Status | Last Login | Actions
 *  4. Create User modal — CF adminCreateUser + sendPasswordResetEmail
 *  5. Edit User modal  — change role (CF) + activate/deactivate
 */

import React, { useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getDocs } from 'firebase/firestore'
import { usersCol } from '../../../lib/firestore'
import {
  assignUserRole,
  deactivateUser,
  reactivateUser,
  createAppUser,
  hardDeleteUser,
  sendPasswordReset,
  updateUserProfile,
} from '../../../services/userService'
import { useViewAsStore } from '../../../store/viewAsStore'
import { ROLE_HOME } from '../../../types/auth'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { CreateUserModal } from '../../../components/ui/CreateUserModal'
import { formatDate } from '../../../utils/format'
import type { AppUser } from '../../../types/user'
import type { UserRole } from '../../../types/user'
import './UserManagement.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const OGS_ROLES: UserRole[] = ['admin', 'dispatch', 'driver', 'sales']

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

const DEMO_USERS: Array<{ name: string; email: string; role: UserRole }> = [
  { name: 'Test Admin',    email: 'admin@ogs-demo.test',    role: 'admin'    },
  { name: 'Test Dispatch', email: 'dispatch@ogs-demo.test', role: 'dispatch' },
  { name: 'Test Driver',   email: 'driver@ogs-demo.test',   role: 'driver'   },
  { name: 'Test Sales',    email: 'sales@ogs-demo.test',    role: 'sales'    },
  { name: 'Test Customer', email: 'customer@ogs-demo.test', role: 'customer' },
]

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchAllUsers(): Promise<AppUser[]> {
  // Do NOT use orderBy here — Firestore silently excludes docs that lack the
  // ordered field (e.g. web-signup users only write firstName/lastName, not name).
  // Sort client-side and synthesize 'name' from firstName+lastName when missing.
  // Only return OGS staff — customer users are managed from the customer profile.
  const snap = await getDocs(usersCol)
  const OGS_ROLE_SET = new Set<string>(OGS_ROLES)
  const users = snap.docs
    .map((d) => {
      const data = d.data() as unknown as Record<string, unknown>
      const name =
        (data['name'] as string | undefined) ??
        [`${data['firstName'] ?? ''}`, `${data['lastName'] ?? ''}`].join(' ').trim() ??
        (data['email'] as string | undefined) ??
        d.id
      return { ...data, name, id: d.id } as AppUser
    })
    .filter((u) => OGS_ROLE_SET.has(u.role))
  return users.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
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

// ── Seed Demo Users Modal ─────────────────────────────────────────────────────

type SeedStatus = 'idle' | 'running' | 'created' | 'exists' | 'error'

interface SeedResult { role: UserRole; status: SeedStatus; error?: string }

const SeedDemoUsersModal: React.FC<{ onClose: () => void; onDone: () => void }> = ({ onClose, onDone }) => {
  const [results, setResults] = useState<SeedResult[]>(
    DEMO_USERS.map((u) => ({ role: u.role, status: 'idle' as SeedStatus })),
  )
  const [running, setRunning] = useState(false)
  const [done,    setDone]    = useState(false)

  async function handleCreate() {
    setRunning(true)
    for (let i = 0; i < DEMO_USERS.length; i++) {
      const demo = DEMO_USERS[i]
      setResults((prev) => prev.map((r, idx) => idx === i ? { ...r, status: 'running' } : r))
      try {
        await createAppUser({ name: demo.name, email: demo.email, role: demo.role })
        setResults((prev) => prev.map((r, idx) => idx === i ? { ...r, status: 'created' } : r))
      } catch (err: unknown) {
        const msg = (err as Error).message ?? ''
        const isExists = msg.includes('already-exists') || msg.includes('already exists')
        setResults((prev) => prev.map((r, idx) =>
          idx === i ? { ...r, status: isExists ? 'exists' : 'error', error: isExists ? undefined : msg } : r,
        ))
      }
    }
    setRunning(false)
    setDone(true)
    onDone()
  }

  const statusLabel: Record<SeedStatus, string> = {
    idle:    '—',
    running: '⟳',
    created: '✓ Created',
    exists:  '⊙ Already exists',
    error:   '✕ Error',
  }

  return (
    <Modal open onClose={onClose} title="Create demo accounts" size="md">
      <div className="um-seed">
        <p className="um-seed__desc">
          Creates one test account per role for development and QA.
          Each new user will receive a password-reset email so they can set their password.
        </p>
        <div className="um-seed__list">
          {DEMO_USERS.map((demo, i) => {
            const result = results[i]
            return (
              <div key={demo.role} className="um-seed__row">
                <RoleBadge role={demo.role} />
                <span className="um-seed__name">{demo.name}</span>
                <span className="um-seed__email">{demo.email}</span>
                <span className={`um-seed__status um-seed__status--${result.status}`}>
                  {result.status === 'error'
                    ? `✕ ${result.error ?? 'Error'}`
                    : statusLabel[result.status]}
                </span>
              </div>
            )
          })}
        </div>
        <div className="um-form__actions">
          {!done ? (
            <>
              <Button type="button" variant="ghost" onClick={onClose} disabled={running}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleCreate} loading={running} disabled={running}>
                Create test accounts
              </Button>
            </>
          ) : (
            <Button type="button" variant="primary" onClick={onClose}>
              Done
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ── Edit User Modal ───────────────────────────────────────────────────────────

interface EditUserModalProps {
  user:      AppUser
  onClose:   () => void
  onUpdated: () => void
  onRefresh: () => void
}

const EditUserModal: React.FC<EditUserModalProps> = ({ user, onClose, onUpdated, onRefresh }) => {
  const [name,      setName]      = useState(user.name ?? '')
  const [phone,     setPhone]     = useState(user.phone ?? '')
  const [position,  setPosition]  = useState(user.position ?? '')
  const [role,      setRole]      = useState<UserRole>(user.role)
  const [statusMsg, setStatusMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  const normalizedName = name.trim()
  const normalizedPhone = phone.trim()
  const normalizedPosition = position.trim()
  const profileChanged =
    normalizedName !== (user.name ?? '').trim()
    || normalizedPhone !== (user.phone ?? '').trim()
    || normalizedPosition !== (user.position ?? '').trim()
  const roleChanged    = role !== user.role

  const roleMutation = useMutation({
    mutationFn: () => assignUserRole(user.id, role),
    onSuccess:  () => { onUpdated() },
    onError:    (err: Error) => setStatusMsg({ tone: 'error', text: err.message || 'Failed to update role.' }),
  })

  const toggleMutation = useMutation({
    mutationFn: () => (user.active ? deactivateUser(user.id) : reactivateUser(user.id)),
    onSuccess:  () => { onUpdated() },
    onError:    (err: Error) => setStatusMsg({ tone: 'error', text: err.message || 'Failed to update status.' }),
  })

  const resetMutation = useMutation({
    mutationFn: () => sendPasswordReset(user.email),
    onSuccess:  () => setStatusMsg({ tone: 'success', text: 'Password reset email sent.' }),
    onError:    (err: Error) => setStatusMsg({ tone: 'error', text: err.message || 'Failed to send reset email.' }),
  })

  const profileMutation = useMutation({
    mutationFn: async () => {
      if (!normalizedName) {
        throw new Error('Full name is required.')
      }
      await updateUserProfile(user.id, {
        name: normalizedName,
        phone: normalizedPhone,
        position: normalizedPosition,
      })
    },
    onSuccess: () => {
      setStatusMsg({ tone: 'success', text: 'Profile saved.' })
      onRefresh()
    },
    onError: (err: Error) => {
      setStatusMsg({ tone: 'error', text: err.message || 'Failed to save profile.' })
    },
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
              {OGS_ROLES.map((r) => (
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

        {/* Profile fields */}
        <section className="um-edit__section">
          <p className="um-edit__section-label">Profile</p>
          <div className="um-edit__profile-grid">
            <label className="ui-field">
              <span className="ui-field__label">Full name</span>
              <input
                className="ui-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter full name"
                autoComplete="name"
              />
            </label>
            <label className="ui-field">
              <span className="ui-field__label">Email</span>
              <input
                className="ui-input"
                value={user.email}
                readOnly
                disabled
                aria-readonly="true"
              />
            </label>
            <label className="ui-field">
              <span className="ui-field__label">Phone number</span>
              <input
                className="ui-input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 555-5555"
                autoComplete="tel"
              />
            </label>
            <label className="ui-field">
              <span className="ui-field__label">Title / position <span className="um-optional">optional</span></span>
              <input
                className="ui-input"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                placeholder="Sales Representative"
                autoComplete="organization-title"
              />
            </label>
          </div>
          <div className="um-edit__profile-actions">
            <Button
              variant="primary"
              size="sm"
              onClick={() => profileMutation.mutate()}
              disabled={!profileChanged}
              loading={profileMutation.isPending}
            >
              Save Profile
            </Button>
          </div>
          <p className="um-edit__hint">
            Email is managed through Firebase Auth and is read-only here.
          </p>
        </section>

        {/* Password reset */}
        <section className="um-edit__section">
          <p className="um-edit__section-label">Password Reset</p>
          <div className="um-edit__status-row">
            <p className="um-edit__hint" style={{ margin: 0 }}>
              Send a password-reset link to <strong>{user.email}</strong>
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => resetMutation.mutate()}
              loading={resetMutation.isPending}
            >
              Send Reset Email
            </Button>
          </div>
        </section>

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

        {statusMsg && (
          <p
            className={statusMsg.tone === 'error' ? 'um-form__error' : 'um-form__success'}
            role={statusMsg.tone === 'error' ? 'alert' : 'status'}
          >
            {statusMsg.text}
          </p>
        )}

        <div className="um-form__actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

      </div>
    </Modal>
  )
}

// ── Delete Confirm Modal ──────────────────────────────────────────────────────

interface DeleteConfirmModalProps {
  user:      AppUser
  onClose:   () => void
  onDeleted: () => void
}

const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({ user, onClose, onDeleted }) => {
  const [error, setError] = useState('')

  const deleteMutation = useMutation({
    mutationFn: () => hardDeleteUser(user.id),
    onSuccess:  () => { onDeleted() },
    onError:    (err: Error) => setError(err.message || 'Failed to delete user.'),
  })

  return (
    <Modal open onClose={onClose} title="Delete User" size="sm">
      <div className="um-edit">
        <p style={{ marginBottom: '1rem' }}>
          Permanently delete <strong>{user.name}</strong> ({user.email})?
          This removes their Firebase Auth account and all portal access.
          This action cannot be undone.
        </p>
        {error && <p className="um-form__error" role="alert">{error}</p>}
        <div className="um-form__actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={deleteMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => deleteMutation.mutate()}
            loading={deleteMutation.isPending}
          >
            Delete permanently
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export const UserManagement: React.FC = () => {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { setViewAsUser } = useViewAsStore()

  const [searchTerm,     setSearchTerm]     = useState('')
  const [roleFilter,     setRoleFilter]     = useState<UserRole | 'all'>('all')
  const [createOpen,     setCreateOpen]     = useState(false)
  const [seedOpen,       setSeedOpen]       = useState(false)
  const [editUser,       setEditUser]       = useState<AppUser | null>(null)
  const [deleteTarget,   setDeleteTarget]   = useState<AppUser | null>(null)

  const usersQuery = useQuery({
    queryKey:  ['admin', 'users'],
    queryFn:   fetchAllUsers,
    staleTime: 60 * 1000,
  })

  const users     = usersQuery.data ?? []
  const isLoading = usersQuery.isPending
  const hasError  = usersQuery.isError

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const counts: Record<UserRole, number> = { admin: 0, dispatch: 0, driver: 0, sales: 0, customer: 0, owner: 0, manager: 0, billing: 0, delivery: 0, viewer: 0 }
    for (const u of users) {
      if (u.role in counts) counts[u.role]++
    }
    return counts
  }, [users])

  const totalUsers = users.length

  // ── Filtered table ─────────────────────────────────────────────────────────
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

  const hasFilters = searchTerm || roleFilter !== 'all'

  const handleCreated = useCallback(() => {
    setCreateOpen(false)
    queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
  }, [queryClient])

  const handleUpdated = useCallback(() => {
    setEditUser(null)
    queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
  }, [queryClient])

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
  }, [queryClient])

  const handleDeleted = useCallback(() => {
    setDeleteTarget(null)
    queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
  }, [queryClient])

  const lastLoginOf = (user: AppUser): string => {
    const ext = user as AppUser & { lastLoginAt?: { toDate(): Date } }
    return ext.lastLoginAt ? formatDate(ext.lastLoginAt) : '—'
  }

  return (
    <div className="um">

      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="um__header">
        <div>
          <h1 className="um__title">User Management</h1>
          <p className="um__subtitle">
            {totalUsers} portal account{totalUsers !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="um__header-actions">
          <Button variant="ghost" size="sm" onClick={() => setSeedOpen(true)}>
            Seed test users
          </Button>
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            + Create User
          </Button>
        </div>
      </div>

      {/* ── 1. Stat cards ──────────────────────────────────────────────── */}
      <div className="um__stats-group">
        <p className="um__stats-label">OGS Staff</p>
        <div className="um__stats">
          {OGS_ROLES.map((r) => (
            <StatCard key={r} role={r} count={stats[r]} total={totalUsers} />
          ))}
        </div>
      </div>


      {/* ── 2. Filter bar ──────────────────────────────────────────────── */}
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
          {OGS_ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
        <span className="um__result-count">
          {filtered.length} user{filtered.length !== 1 ? 's' : ''}
        </span>
        {hasFilters && (
          <button
            type="button"
            className="um__filter-clear"
            onClick={() => { setSearchTerm(''); setRoleFilter('all') }}
          >
            Clear
          </button>
        )}
      </div>

      {/* ── 3. User table ──────────────────────────────────────────────── */}
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
                {filtered.map((user) => {
                  return (
                    <tr key={user.id} className={!user.active ? 'um__row--inactive' : ''}>
                      <td className="um__cell-name">
                        <span className="um__avatar" aria-hidden="true">
                          {(user.name || user.email || '?').charAt(0).toUpperCase()}
                        </span>
                        <span className="um__cell-name-text">
                          {user.name}
                        </span>
                      </td>
                      <td className="um__cell-email">{user.email}</td>
                      <td><RoleBadge role={user.role} /></td>
                      <td><StatusDot active={user.active} /></td>
                      <td className="um__cell-date">{lastLoginOf(user)}</td>
                      <td>
                        <div className="um__actions">
                          <button
                            type="button"
                            className="um__action-btn"
                            onClick={() => setEditUser(user)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="um__action-btn um__action-btn--view-as"
                            onClick={() => { setViewAsUser(user); navigate(ROLE_HOME[user.role]) }}
                            title={`View portal as ${user.name}`}
                          >
                            View as
                          </button>
                          <button
                            type="button"
                            className="um__action-btn um__action-btn--danger"
                            onClick={() => setDeleteTarget(user)}
                            title={`Delete ${user.name}`}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      {createOpen && (
        <CreateUserModal
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
          allowedRoles={OGS_ROLES}
        />
      )}

      {seedOpen && (
        <SeedDemoUsersModal
          onClose={() => setSeedOpen(false)}
          onDone={() => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })}
        />
      )}

      {editUser && (
        <EditUserModal
          user={editUser}
          onClose={() => setEditUser(null)}
          onUpdated={handleUpdated}
          onRefresh={handleRefresh}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          user={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={handleDeleted}
        />
      )}

    </div>
  )
}

export default UserManagement
