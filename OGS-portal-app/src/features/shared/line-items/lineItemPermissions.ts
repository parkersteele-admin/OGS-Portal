import type { UserRole } from '../../../types/user'

export interface LineItemPricingPermissions {
  canViewInternalPricing: boolean
  canEditInternalPricing: boolean
  enforceMarginFloor: boolean
}

export function getLineItemPricingPermissions(role: UserRole | null | undefined): LineItemPricingPermissions {
  const isAdmin = role === 'admin'
  return {
    canViewInternalPricing: isAdmin,
    canEditInternalPricing: isAdmin,
    enforceMarginFloor: !isAdmin,
  }
}
