import { useState, useEffect } from 'react'
import { getCompanySettings } from '../services/companySettingsService'
import type { CompanySettings } from '../types/companySettings'
import { DEFAULT_COMPANY_SETTINGS } from '../types/companySettings'

export function useCompanySettings() {
  const [settings, setSettings] = useState<CompanySettings>(DEFAULT_COMPANY_SETTINGS)

  useEffect(() => {
    getCompanySettings().then(setSettings).catch(() => {})
  }, [])

  return settings
}
