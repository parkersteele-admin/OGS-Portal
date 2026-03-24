export interface CompanySettings {
  name:    string
  tagline: string
  email:   string
  phone:   string
  website: string
  address: string
  city:    string
  state:   string
  zip:     string
  taxId:   string
  logoUrl: string
}

export const DEFAULT_COMPANY_SETTINGS: CompanySettings = {
  name:    '',
  tagline: '',
  email:   '',
  phone:   '',
  website: '',
  address: '',
  city:    '',
  state:   '',
  zip:     '',
  taxId:   '',
  logoUrl: '',
}
