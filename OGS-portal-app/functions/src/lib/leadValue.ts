type UsageEntryLike = {
  category?: string | null
  monthlyEst?: string | null
}

type CustomerLike = {
  usageProfile?: UsageEntryLike[] | null
}

const CATEGORY_VALUE_MULTIPLIER: Record<string, number> = {
  co2: 55,
  nitrogen: 60,
  oxygen: 85,
  argon: 95,
  propane: 75,
  helium: 140,
  not_sure: 40,
}

function normalizeCategory(category?: string | null): string {
  return (category ?? '').trim().toLowerCase()
}

function estimateMonthlyUnits(monthlyEst?: string | null): number {
  switch ((monthlyEst ?? '').trim().toLowerCase()) {
    case '< 5 cylinders':
      return 3
    case '5-10 cylinders':
    case '5–10 cylinders':
      return 8
    case '10-25 cylinders':
    case '10–25 cylinders':
      return 18
    case '25+ cylinders':
      return 30
    case 'not sure':
      return 6
    default:
      return 0
  }
}

export async function calculateEstimatedValue(
  _companyId: string,
  customer: CustomerLike,
): Promise<number> {
  const usageProfile = Array.isArray(customer.usageProfile) ? customer.usageProfile : []

  const estimated = usageProfile.reduce((total, entry) => {
    const category = normalizeCategory(entry.category)
    const units = estimateMonthlyUnits(entry.monthlyEst)
    const multiplier = CATEGORY_VALUE_MULTIPLIER[category] ?? 50
    return total + units * multiplier
  }, 0)

  return Math.round(estimated)
}
