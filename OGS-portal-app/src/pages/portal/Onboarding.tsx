/**
 * src/pages/portal/Onboarding.tsx
 *
 * Onboarding wizard — routes to steps 1–5 based on setupStep.
 *
 * Guard: requires Firebase Auth + companyId claim.
 * If setupComplete === true, redirects to /portal/dashboard.
 *
 * Progress persists to customers/{companyId}.setupStep on each step save.
 * Customers can close the browser and resume from wherever they left off.
 */

import React, { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useOnboarding } from '../../hooks/useOnboarding'
import { getLocations } from '../../services/onboardingService'
import { OnboardingStepper } from '../../components/onboarding/OnboardingStepper'
import { Step1BusinessInfo } from '../../components/onboarding/steps/Step1BusinessInfo'
import { Step2DeliverySetup } from '../../components/onboarding/steps/Step2DeliverySetup'
import { Step3GasUsage } from '../../components/onboarding/steps/Step3GasUsage'
import { Step4PaymentNotifications } from '../../components/onboarding/steps/Step4PaymentNotifications'
import { Step5Review } from '../../components/onboarding/steps/Step5Review'
import type { DeliveryLocation } from '../../types/company'
import '../../components/onboarding/Onboarding.css'

const OnboardingPage: React.FC = () => {
  const { user } = useAuth()
  const { company, setupComplete, companyId, loading } = useOnboarding()

  // Active step — starts at max(1, setupStep)
  const [activeStep, setActiveStep] = useState<number>(1)
  // Highest step the user has completed (for stepper clickability)
  const [completedUpTo, setCompletedUpTo] = useState<number>(0)

  const [locations, setLocations] = useState<DeliveryLocation[]>([])
  const [locationsLoaded, setLocationsLoaded] = useState(false)

  // Seed the active step from saved progress
  useEffect(() => {
    if (!loading && company) {
      const savedStep = company.setupStep ?? 0
      const startStep = Math.max(1, Math.min(savedStep + 1, 5))
      setActiveStep(startStep)
      setCompletedUpTo(savedStep)
    }
  }, [loading, company])

  // Load locations once companyId is known
  useEffect(() => {
    if (!companyId || locationsLoaded) return
    getLocations(companyId)
      .then((locs) => {
        setLocations(locs)
        setLocationsLoaded(true)
      })
      .catch(() => setLocationsLoaded(true))
  }, [companyId, locationsLoaded])

  // ── Guards ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="layout-loading" aria-live="polite">
        <span className="layout-loading__spinner" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (!companyId) {
    // No company yet — pending join request
    return <Navigate to="/portal/dashboard" replace />
  }

  if (setupComplete) {
    return <Navigate to="/portal/dashboard" replace />
  }

  if (!company) {
    return (
      <div className="layout-loading">
        <span className="layout-loading__spinner" />
      </div>
    )
  }

  // ── Navigation handlers ──────────────────────────────────────────────────

  const goToStep = (step: number) => {
    setActiveStep(step)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleStepComplete = (completedStep: number) => {
    setCompletedUpTo(Math.max(completedUpTo, completedStep))
    goToStep(completedStep + 1)
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="ob-page">
      <OnboardingStepper
        currentStep={activeStep}
        completedUpTo={completedUpTo}
        onStepClick={goToStep}
      />

      <div className="ob-page__content">
        {activeStep === 1 && (
          <Step1BusinessInfo
            company={company}
            onNext={() => handleStepComplete(1)}
          />
        )}

        {activeStep === 2 && (
          <Step2DeliverySetup
            company={company}
            locations={locations}
            onNext={() => {
              handleStepComplete(2)
              // Refresh locations after step 2 save
              if (companyId) {
                getLocations(companyId)
                  .then(setLocations)
                  .catch(() => {})
              }
            }}
            onBack={() => goToStep(1)}
          />
        )}

        {activeStep === 3 && (
          <Step3GasUsage
            company={company}
            onNext={() => handleStepComplete(3)}
            onBack={() => goToStep(2)}
          />
        )}

        {activeStep === 4 && (
          <Step4PaymentNotifications
            company={company}
            uid={user.id}
            onNext={() => handleStepComplete(4)}
            onBack={() => goToStep(3)}
          />
        )}

        {activeStep === 5 && (
          <Step5Review
            company={company}
            locations={locations}
            onEditStep={goToStep}
          />
        )}
      </div>
    </div>
  )
}

export default OnboardingPage
