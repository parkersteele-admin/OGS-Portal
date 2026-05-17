/**
 * src/components/layouts/OnboardingLayout.tsx
 *
 * Minimal layout used exclusively during the onboarding wizard.
 * No sidebar nav — just the OGS logo, stepper, and step content.
 */

import React from 'react'
import { Outlet } from 'react-router-dom'
import { BrandLogo } from '../branding/BrandLogo'
import './OnboardingLayout.css'

export const OnboardingLayout: React.FC = () => (
  <div className="ob-layout">
    <header className="ob-layout__header">
      <BrandLogo className="ob-layout__logo" />
    </header>
    <main className="ob-layout__main">
      <Outlet />
    </main>
  </div>
)

export default OnboardingLayout
