import React, { useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { signIn } from '../../lib/auth'
import { useAuth } from '../../hooks/useAuth'
import { ROLE_HOME } from '../../types/auth'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, loading: authLoading } = useAuth()

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [loading, setLoading]   = useState(false)

  // Already signed in — redirect immediately
  React.useEffect(() => {
    if (!authLoading && user) {
      const from = (location.state as { from?: string })?.from
      navigate(from ?? ROLE_HOME[user.role], { replace: true })
    }
  }, [user, authLoading, navigate, location.state])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const appUser = await signIn(email.trim(), password)
      const from = (location.state as { from?: string })?.from
      navigate(from ?? ROLE_HOME[appUser.role], { replace: true })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sign in failed.'
      // Normalise Firebase auth error codes to user-friendly messages
      if (msg.includes('invalid-credential') || msg.includes('wrong-password') || msg.includes('user-not-found')) {
        setError('Incorrect email or password.')
      } else if (msg.includes('too-many-requests')) {
        setError('Too many attempts. Please try again later.')
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  if (authLoading) return null

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--color-bg-2)',
      padding: '24px',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '400px',
        background: 'var(--color-bg)',
        borderRadius: '12px',
        border: '1px solid var(--color-border)',
        padding: '40px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
      }}>
        {/* Logo / Brand */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '48px',
            height: '48px',
            background: 'var(--color-brand)',
            borderRadius: '10px',
            marginBottom: '16px',
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L3 7v10l9 5 9-5V7L12 2z" stroke="white" strokeWidth="2" strokeLinejoin="round"/>
              <path d="M12 12L3 7M12 12l9-5M12 12v10" stroke="white" strokeWidth="2"/>
            </svg>
          </div>
          <h1 style={{
            fontSize: 'var(--font-size-20)',
            fontWeight: 700,
            color: 'var(--color-text)',
            marginBottom: '4px',
          }}>
            OGS Portal
          </h1>
          <p style={{ fontSize: 'var(--font-size-13)', color: 'var(--color-text-3)' }}>
            Ohio Gas Supply Co.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={loading}
            />
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={loading}
            />

            {error && (
              <div style={{
                padding: '10px 14px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '6px',
                fontSize: 'var(--font-size-13)',
                color: 'var(--color-danger)',
              }} role="alert">
                {error}
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={loading}
              style={{ width: '100%', marginTop: '4px' }}
            >
              Sign in
            </Button>
          </div>
        </form>

        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <Link
            to="/reset-password"
            style={{
              fontSize: 'var(--font-size-13)',
              color: 'var(--color-brand)',
              textDecoration: 'none',
            }}
          >
            Forgot password?
          </Link>
        </div>
      </div>
    </div>
  )
}
