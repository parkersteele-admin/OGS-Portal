/**
 * src/components/onboarding/OnboardingStepper.tsx
 *
 * 5-step horizontal (desktop) / vertical (mobile) progress indicator.
 * - Current step: brand blue accent
 * - Completed steps: checkmark, clickable to navigate back
 * - Future steps: gray
 */

import React from 'react'
import './OnboardingStepper.css'

export const STEP_LABELS = [
  'Business Info',
  'Delivery Setup',
  'Gas Usage',
  'Payment & Notifications',
  'Review',
] as const

interface OnboardingStepperProps {
  currentStep: number      // 1-based (1–5)
  completedUpTo: number    // highest step the user has completed
  onStepClick: (step: number) => void
}

export const OnboardingStepper: React.FC<OnboardingStepperProps> = ({
  currentStep,
  completedUpTo,
  onStepClick,
}) => (
  <nav className="ob-stepper" aria-label="Onboarding progress">
    <ol className="ob-stepper__list">
      {STEP_LABELS.map((label, idx) => {
        const step = idx + 1
        const isCompleted = step <= completedUpTo && step !== currentStep
        const isCurrent = step === currentStep
        const isFuture = step > completedUpTo && !isCurrent
        const isClickable = isCompleted

        return (
          <li
            key={step}
            className={[
              'ob-stepper__item',
              isCurrent   ? 'ob-stepper__item--current'   : '',
              isCompleted ? 'ob-stepper__item--completed'  : '',
              isFuture    ? 'ob-stepper__item--future'     : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <button
              type="button"
              className="ob-stepper__btn"
              onClick={() => isClickable && onStepClick(step)}
              disabled={!isClickable && !isCurrent}
              aria-current={isCurrent ? 'step' : undefined}
              aria-label={`Step ${step}: ${label}${isCompleted ? ' (completed)' : ''}`}
            >
              <span className="ob-stepper__circle">
                {isCompleted ? (
                  <svg
                    className="ob-stepper__check"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M3 8l3.5 3.5 6.5-7"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <span className="ob-stepper__num">{step}</span>
                )}
              </span>
              <span className="ob-stepper__label">{label}</span>
            </button>
            {idx < STEP_LABELS.length - 1 && (
              <div
                className={`ob-stepper__connector${step < completedUpTo ? ' ob-stepper__connector--done' : ''}`}
                aria-hidden="true"
              />
            )}
          </li>
        )
      })}
    </ol>
  </nav>
)
