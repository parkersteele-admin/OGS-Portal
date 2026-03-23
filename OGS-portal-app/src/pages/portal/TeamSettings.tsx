/**
 * src/pages/portal/TeamSettings.tsx
 *
 * Team management for owners and managers.
 * - Invite users by email + role
 * - Show pending join requests with approve/deny actions
 * - Show current team members with remove action
 */

import React, { useState, useEffect } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../../lib/firebase'
import {
  subscribeToTeam,
  subscribeToJoinRequests,
  subscribeToCompanyInvites,
} from '../../services/onboardingService'
import { useAuth } from '../../hooks/useAuth'
import { useOnboarding } from '../../hooks/useOnboarding'
import { Button } from '../../components/ui/Button'
import './TeamSettings.css'
import { Input } from '../../components/ui/Input'
import { Navigate } from 'react-router-dom'
import type { OnboardingUser, JoinRequest, TeamInvite, CustomerRole } from '../../types/company'

const ROLES: { value: CustomerRole; label: string }[] = [
  { value: 'manager', label: 'Manager' },
  { value: 'billing', label: 'Billing' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'viewer', label: 'Viewer' },
]

const TeamSettingsPage: React.FC = () => {
  const { user, role } = useAuth()
  const { company, companyId, loading } = useOnboarding()

  const [team, setTeam] = useState<OnboardingUser[]>([])
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([])
  const [invites, setInvites] = useState<TeamInvite[]>([])

  // Invite form
  const [inviteFirstName, setInviteFirstName] = useState('')
  const [inviteLastName, setInviteLastName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<CustomerRole>('viewer')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null)

  // Approve role picker
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [approveRole, setApproveRole] = useState<CustomerRole>('viewer')

  const [actionError, setActionError] = useState<string | null>(null)

  // Subscribe to live data
  useEffect(() => {
    if (!companyId) return
    const unsubs = [
      subscribeToTeam(companyId, setTeam),
      subscribeToJoinRequests(companyId, setJoinRequests),
      subscribeToCompanyInvites(companyId, setInvites),
    ]
    return () => unsubs.forEach((fn) => fn())
  }, [companyId])

  // ── Permission guard ──────────────────────────────────────────────────────
  if (!loading && role !== 'owner' && role !== 'manager' && role !== 'admin') {
    return <Navigate to="/portal/dashboard" replace />
  }

  // ── Invite ────────────────────────────────────────────────────────────────

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!companyId || !company) return
    setInviting(true)
    setInviteError(null)
    setInviteSuccess(null)
    try {
      const fn = httpsCallable<
        { email: string; companyId: string; role: CustomerRole; firstName: string; lastName: string },
        void
      >(functions, 'inviteTeamMember')
      await fn({
        email: inviteEmail,
        companyId,
        role: inviteRole,
        firstName: inviteFirstName,
        lastName: inviteLastName,
      })
      setInviteSuccess(`Invite sent to ${inviteEmail}.`)
      setInviteFirstName('')
      setInviteLastName('')
      setInviteEmail('')
      setInviteRole('viewer')
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to send invite.')
    } finally {
      setInviting(false)
    }
  }

  // ── Approve join request ──────────────────────────────────────────────────

  const handleApprove = async (requestId: string) => {
    setActionError(null)
    try {
      const fn = httpsCallable<{ requestId: string; role: CustomerRole }, void>(
        functions,
        'approveJoinRequest',
      )
      await fn({ requestId, role: approveRole })
      setApprovingId(null)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to approve request.')
    }
  }

  const handleDeny = async (requestId: string) => {
    setActionError(null)
    try {
      const fn = httpsCallable<{ requestId: string }, void>(
        functions,
        'denyJoinRequest',
      )
      await fn({ requestId })
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to deny request.')
    }
  }

  // ── Remove user ───────────────────────────────────────────────────────────

  const handleRemove = async (uid: string) => {
    if (!confirm('Remove this user from the team?')) return
    setActionError(null)
    try {
      const fn = httpsCallable<{ uid: string }, void>(
        functions,
        'revokeCompanyClaim',
      )
      await fn({ uid })
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to remove user.')
    }
  }

  if (loading) {
    return <div className="layout-loading"><span className="layout-loading__spinner" /></div>
  }

  return (
    <div className="team-settings">
      <h1 className="team-settings__heading">Team Management</h1>

      {actionError && (
        <div className="ob-step__err" role="alert">{actionError}</div>
      )}

      {/* ── Invite section ──────────────────────────────────────────────── */}
      <section className="team-settings__section">
        <h2 className="team-settings__section-title">Invite a User</h2>
        <form
          className="team-settings__invite-form"
          onSubmit={(e) => void handleInvite(e)}
        >
          <div className="ob-step__row">
            <Input
              label="First Name"
              value={inviteFirstName}
              onChange={(e) => setInviteFirstName(e.target.value)}
              required
            />
            <Input
              label="Last Name"
              value={inviteLastName}
              onChange={(e) => setInviteLastName(e.target.value)}
              required
            />
          </div>
          <Input
            label="Email"
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            required
          />
          <div className="ui-field">
            <label className="ui-field__label">Role</label>
            <select
              className="ui-input"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as CustomerRole)}
            >
              {ROLES.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          {inviteError && (
            <p className="ob-step__err" role="alert">{inviteError}</p>
          )}
          {inviteSuccess && (
            <p className="ob-step__success" role="status">{inviteSuccess}</p>
          )}
          <Button type="submit" variant="primary" loading={inviting}>
            Send Invite
          </Button>
        </form>
      </section>

      {/* ── Pending Join Requests ───────────────────────────────────────── */}
      {joinRequests.length > 0 && (
        <section className="team-settings__section">
          <h2 className="team-settings__section-title">
            Join Requests
            <span className="team-settings__badge">{joinRequests.length}</span>
          </h2>
          <div className="team-settings__table">
            <div className="team-settings__table-head">
              <span>Name</span>
              <span>Email</span>
              <span>Requested</span>
              <span>Actions</span>
            </div>
            {joinRequests.map((req) => (
              <div key={req.id} className="team-settings__table-row">
                <span>{req.requesterName}</span>
                <span>{req.requesterEmail}</span>
                <span>
                  {req.createdAt?.toDate().toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
                <div className="team-settings__actions">
                  {approvingId === req.id ? (
                    <div className="team-settings__approve-row">
                      <select
                        className="ui-input ui-input--sm"
                        value={approveRole}
                        onChange={(e) => setApproveRole(e.target.value as CustomerRole)}
                      >
                        {ROLES.map(({ value, label }) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => void handleApprove(req.id)}
                      >
                        Confirm
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setApprovingId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => setApprovingId(req.id)}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => void handleDeny(req.id)}
                      >
                        Deny
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Pending Invites ─────────────────────────────────────────────── */}
      {invites.filter((i) => i.status === 'pending').length > 0 && (
        <section className="team-settings__section">
          <h2 className="team-settings__section-title">Pending Invites</h2>
          <div className="team-settings__table">
            <div className="team-settings__table-head">
              <span>Email</span>
              <span>Role</span>
              <span>Expires</span>
            </div>
            {invites
              .filter((i) => i.status === 'pending')
              .map((inv) => (
                <div key={inv.id} className="team-settings__table-row">
                  <span>{inv.email}</span>
                  <span className="team-settings__role-badge">{inv.role}</span>
                  <span>
                    {inv.expiresAt?.toDate().toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* ── Current Team ────────────────────────────────────────────────── */}
      <section className="team-settings__section">
        <h2 className="team-settings__section-title">Team Members</h2>
        {team.length === 0 ? (
          <p className="ob-review__empty">No team members yet.</p>
        ) : (
          <div className="team-settings__table">
            <div className="team-settings__table-head">
              <span>Name</span>
              <span>Email</span>
              <span>Role</span>
              <span>Status</span>
              <span />
            </div>
            {team.map((member) => {
              const name = [member.firstName, member.lastName].filter(Boolean).join(' ')
              const isSelf = member.uid === user?.id
              return (
                <div key={member.uid} className="team-settings__table-row">
                  <span>{name}</span>
                  <span>{member.email}</span>
                  <span className="team-settings__role-badge">{member.role}</span>
                  <span
                    className={`team-settings__status-badge team-settings__status-badge--${member.status}`}
                  >
                    {member.status}
                  </span>
                  <span>
                    {!isSelf && !member.isPrimary && (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => void handleRemove(member.uid)}
                      >
                        Remove
                      </Button>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

export default TeamSettingsPage
