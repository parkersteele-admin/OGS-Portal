/**
 * src/components/ErrorBoundary.tsx
 *
 * React Error Boundary for graceful error handling.
 * Catches errors in child components and displays user-friendly messages.
 *
 * PROBLEM SOLVED:
 * ───────────────
 * Unhandled errors in child components cause white screen of death.
 * Error boundaries prevent cascading failures and provide fallback UI.
 *
 * USAGE:
 * ──────
 * <ErrorBoundary fallback={<CustomErrorUI />}>
 *   <YourComponent />
 * </ErrorBoundary>
 *
 * If YourComponent throws, ErrorBoundary catches it and shows fallback UI
 * instead of crashing the whole app.
 */

import React, { ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface ErrorInfo {
  componentStack: string
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

/**
 * React Error Boundary component.
 * Catches errors in descendant components and displays fallback UI.
 *
 * @example
 *   <ErrorBoundary>
 *     <ExpensiveComponent />
 *   </ErrorBoundary>
 *
 * @example
 *   <ErrorBoundary fallback={<div>Something went wrong</div>}>
 *     <Dashboard />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
    }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error for debugging
    console.error('[ErrorBoundary]', error, errorInfo)

    // Call user's error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo)
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '200px',
              padding: '20px',
              backgroundColor: '#f8f9fa',
              borderRadius: '8px',
              border: '1px solid #dee2e6',
            }}
          >
            <h2 style={{ color: '#dc3545', marginBottom: '10px' }}>
              Something went wrong
            </h2>
            <p style={{ color: '#6c757d', marginBottom: '15px' }}>
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 16px',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Reload page
            </button>
          </div>
        )
      )
    }

    return this.props.children
  }
}

/**
 * Firestore-specific error boundary.
 * Handles common Firestore errors with tailored messages.
 *
 * @example
 *   <FirestoreErrorBoundary>
 *     <CustomerDashboard />
 *   </FirestoreErrorBoundary>
 */
export class FirestoreErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
    }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[FirestoreErrorBoundary]', error, errorInfo)
    if (this.props.onError) {
      this.props.onError(error, errorInfo)
    }
  }

  getErrorMessage(error: Error): string {
    const message = error.message.toLowerCase()

    if (message.includes('permission-denied')) {
      return 'You do not have permission to access this resource.'
    }

    if (message.includes('not-found')) {
      return 'The resource you are looking for could not be found.'
    }

    if (message.includes('unavailable')) {
      return 'The service is currently unavailable. Please try again later.'
    }

    if (message.includes('deadline-exceeded')) {
      return 'The request took too long to complete. Please try again.'
    }

    if (message.includes('unauthenticated')) {
      return 'You are not authenticated. Please sign in again.'
    }

    return error.message || 'An unexpected Firestore error occurred'
  }

  render(): ReactNode {
    if (this.state.hasError) {
      const message = this.getErrorMessage(this.state.error!)

      return (
        this.props.fallback || (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '200px',
              padding: '20px',
              backgroundColor: '#fee',
              borderRadius: '8px',
              border: '2px solid #dc3545',
            }}
          >
            <h2 style={{ color: '#dc3545', marginBottom: '10px' }}>
              Database Error
            </h2>
            <p style={{ color: '#721c24', marginBottom: '15px' }}>{message}</p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => window.location.reload()}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#dc3545',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                Reload
              </button>
              <button
                onClick={() => window.history.back()}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                Go back
              </button>
            </div>
          </div>
        )
      )
    }

    return this.props.children
  }
}

/**
 * USAGE IN APP STRUCTURE
 *
 * // App.tsx (top-level)
 * <ErrorBoundary>
 *   <Router />
 * </ErrorBoundary>
 *
 * // Dashboard.tsx (page-level)
 * <FirestoreErrorBoundary>
 *   <DashboardContent />
 * </FirestoreErrorBoundary>
 *
 * // Component.tsx (component-level)
 * <ErrorBoundary onError={(err) => logToSentry(err)}>
 *   <ExpensiveSubComponent />
 * </ErrorBoundary>
 *
 * BENEFITS:
 * ─────────
 * ✅ Catch errors before they reach user
 * ✅ Provide fallback UI (no white screen of death)
 * ✅ Better error messages for different error types
 * ✅ Graceful degradation (rest of app still works)
 * ✅ Error logging integration point
 */
