import { getDocs } from 'firebase/firestore'
import { customersCol, leadsCol, quotesCol, usersCol } from '../lib/firestore'
import type { Customer } from '../types/customer'
import type { Lead, LeadStatus, Quote } from '../types/crm'
import type { AppUser } from '../types/user'

export type SalesDashboardPreset =
  | 'last7'
  | 'last30'
  | 'month'
  | 'qtd'
  | 'ytd'
  | 'custom'

export interface SalesDashboardFilters {
  preset: SalesDashboardPreset
  startDate: string
  endDate: string
  salesRepId: string
  stage: LeadStatus | 'all'
  company: string
}

export interface SalesDashboardSnapshot {
  quotes: Quote[]
  leads: Lead[]
  customers: Customer[]
  users: AppUser[]
}

export interface SalesDashboardOption {
  value: string
  label: string
}

export interface SalesKpis {
  wonRevenue: number
  openPipeline: number
  quotesSent: number
  winRate: number
  averageDealSize: number
  newLeads: number
}

export interface SalesTrendPoint {
  label: string
  value: number
}

export interface SalesComparisonPoint {
  label: string
  sent: number
  won: number
}

export interface SalesPipelineStagePoint {
  stage: LeadStatus
  label: string
  count: number
  value: number
}

export interface SalesRepLeaderboardEntry {
  repId: string
  repName: string
  wonRevenue: number
  quotesSent: number
  winRate: number
}

export interface SalesCompanyLeaderboardEntry {
  company: string
  totalQuoted: number
  totalWon: number
  lastActivity: Date | null
}

export interface RecentWinEntry {
  quoteId: string
  quoteNumber: string
  company: string
  repName: string
  total: number
  acceptedAt: Date | null
}

export interface SalesDashboardData {
  kpis: SalesKpis
  options: {
    salesReps: SalesDashboardOption[]
    stages: SalesDashboardOption[]
    companies: SalesDashboardOption[]
  }
  charts: {
    revenueOverTime: SalesTrendPoint[]
    quotesSentVsWon: SalesComparisonPoint[]
    pipelineByStage: SalesPipelineStagePoint[]
  }
  leaderboards: {
    reps: SalesRepLeaderboardEntry[]
    companies: SalesCompanyLeaderboardEntry[]
  }
  recentWins: RecentWinEntry[]
  dataNotes: Array<{ title: string; explanation: string }>
}

const LEAD_STAGE_ORDER: LeadStatus[] = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost']
const OPEN_PIPELINE_STAGES: LeadStatus[] = ['new', 'contacted', 'qualified', 'proposal']

const LEAD_STAGE_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  proposal: 'Proposal',
  won: 'Won',
  lost: 'Lost',
}

export function getSalesDashboardPresetRange(
  preset: Exclude<SalesDashboardPreset, 'custom'>,
  now = new Date(),
): { startDate: string; endDate: string } {
  const end = new Date(now)
  const start = new Date(now)

  if (preset === 'last7') {
    start.setDate(end.getDate() - 6)
  } else if (preset === 'last30') {
    start.setDate(end.getDate() - 29)
  } else if (preset === 'month') {
    start.setDate(1)
  } else if (preset === 'qtd') {
    start.setMonth(Math.floor(end.getMonth() / 3) * 3, 1)
  } else if (preset === 'ytd') {
    start.setMonth(0, 1)
  }

  return {
    startDate: toIsoDate(start),
    endDate: toIsoDate(end),
  }
}

export async function fetchSalesDashboardSnapshot(): Promise<SalesDashboardSnapshot> {
  const [quotesSnap, leadsSnap, customersSnap, usersSnap] = await Promise.all([
    getDocs(quotesCol),
    getDocs(leadsCol),
    getDocs(customersCol),
    getDocs(usersCol),
  ])

  return {
    quotes: quotesSnap.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as Quote),
    leads: leadsSnap.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as Lead),
    customers: customersSnap.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as Customer),
    users: usersSnap.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as AppUser),
  }
}

export function buildSalesDashboardData(
  snapshot: SalesDashboardSnapshot,
  filters: SalesDashboardFilters,
): SalesDashboardData {
  const usersById = new Map(snapshot.users.map((user) => [user.id, user]))
  const leadsById = new Map(snapshot.leads.map((lead) => [lead.id, lead]))
  const customersById = new Map(snapshot.customers.map((customer) => [customer.id, customer]))
  const range = getDateRange(filters)

  const salesReps = buildSalesRepOptions(snapshot.users)
  const companies = buildCompanyOptions(snapshot.leads, snapshot.customers)
  const stages = LEAD_STAGE_ORDER.map((stage) => ({ value: stage, label: LEAD_STAGE_LABELS[stage] }))

  const matchesLeadDimensions = (lead: Lead) => {
    if (filters.salesRepId && lead.assignedTo !== filters.salesRepId) return false
    if (filters.stage !== 'all' && lead.status !== filters.stage) return false
    if (filters.company && resolveLeadCompany(lead) !== filters.company) return false
    return true
  }

  const matchesQuoteDimensions = (quote: Quote) => {
    if (filters.salesRepId && quote.createdBy !== filters.salesRepId) return false
    if (filters.company && resolveQuoteCompany(quote, customersById, leadsById) !== filters.company) return false
    if (filters.stage !== 'all') {
      const linkedLead = quote.leadId ? leadsById.get(quote.leadId) : null
      if (!linkedLead || linkedLead.status !== filters.stage) return false
    }
    return true
  }

  const filteredLeads = snapshot.leads.filter(matchesLeadDimensions)
  const filteredQuotes = snapshot.quotes.filter(matchesQuoteDimensions)

  const rangedLeads = filteredLeads.filter((lead) => isInRange(timestampToDate(lead.createdAt), range))
  const rangedSentQuotes = filteredQuotes.filter((quote) => {
    if (quote.status === 'draft') return false
    return isInRange(timestampToDate(quote.createdAt), range)
  })
  const rangedWonQuotes = filteredQuotes.filter((quote) => {
    if (quote.status !== 'accepted') return false
    return isInRange(timestampToDate(quote.acceptedAt) ?? timestampToDate(quote.updatedAt), range)
  })

  const openPipelineLeads = filteredLeads.filter((lead) => OPEN_PIPELINE_STAGES.includes(lead.status))
  const wonRevenue = sum(rangedWonQuotes.map((quote) => quote.total || 0))
  const quotesSent = rangedSentQuotes.length
  const wins = rangedWonQuotes.length
  const winRate = quotesSent > 0 ? wins / quotesSent : 0
  const averageDealSize = wins > 0 ? wonRevenue / wins : 0
  const newLeads = rangedLeads.length
  const openPipeline = sum(openPipelineLeads.map((lead) => lead.estimatedValue || 0))

  const revenueOverTime = buildRevenueSeries(rangedWonQuotes, range)
  const quotesSentVsWon = buildQuoteComparisonSeries(rangedSentQuotes, rangedWonQuotes, range)
  const pipelineByStage = LEAD_STAGE_ORDER
    .map((stage) => {
      const leads = openPipelineLeads.filter((lead) => lead.status === stage)
      return {
        stage,
        label: LEAD_STAGE_LABELS[stage],
        count: leads.length,
        value: sum(leads.map((lead) => lead.estimatedValue || 0)),
      }
    })
    .filter((entry) => entry.count > 0 || entry.stage === filters.stage)

  const repLeaderboards = buildRepLeaderboard(rangedSentQuotes, rangedWonQuotes, usersById)
  const companyLeaderboards = buildCompanyLeaderboard(
    rangedSentQuotes,
    rangedWonQuotes,
    customersById,
    leadsById,
  )

  const recentWins = rangedWonQuotes
    .slice()
    .sort((left, right) => {
      const leftDate = timestampToDate(left.acceptedAt) ?? timestampToDate(left.updatedAt)
      const rightDate = timestampToDate(right.acceptedAt) ?? timestampToDate(right.updatedAt)
      return (rightDate?.getTime() ?? 0) - (leftDate?.getTime() ?? 0)
    })
    .slice(0, 6)
    .map((quote) => ({
      quoteId: quote.id,
      quoteNumber: quote.quoteNumber,
      company: resolveQuoteCompany(quote, customersById, leadsById),
      repName: resolveRepName(quote.createdBy, usersById),
      total: quote.total || 0,
      acceptedAt: timestampToDate(quote.acceptedAt) ?? timestampToDate(quote.updatedAt),
    }))

  return {
    kpis: {
      wonRevenue,
      openPipeline,
      quotesSent,
      winRate,
      averageDealSize,
      newLeads,
    },
    options: {
      salesReps,
      stages,
      companies,
    },
    charts: {
      revenueOverTime,
      quotesSentVsWon,
      pipelineByStage,
    },
    leaderboards: {
      reps: repLeaderboards,
      companies: companyLeaderboards,
    },
    recentWins,
    dataNotes: [
      {
        title: 'Quotes sent',
        explanation: 'Uses created date as a proxy until sent timestamps are stored.',
      },
      {
        title: 'Pipeline history',
        explanation: 'Historical snapshots require stage history tracking.',
      },
      {
        title: 'Won revenue',
        explanation: 'Based on accepted quotes, not booked invoices.',
      },
    ],
  }
}

function buildSalesRepOptions(users: AppUser[]): SalesDashboardOption[] {
  return users
    .filter((user) => user.role === 'sales' || user.role === 'admin')
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((user) => ({ value: user.id, label: user.name }))
}

function buildCompanyOptions(leads: Lead[], customers: Customer[]): SalesDashboardOption[] {
  const labels = new Set<string>()

  leads.forEach((lead) => {
    const label = resolveLeadCompany(lead)
    if (label) labels.add(label)
  })

  customers.forEach((customer) => {
    if (customer.name) labels.add(customer.name)
  })

  return [...labels]
    .sort((left, right) => left.localeCompare(right))
    .map((label) => ({ value: label, label }))
}

function buildRevenueSeries(quotes: Quote[], range: DateRange): SalesTrendPoint[] {
  const buckets = buildBuckets(range)

  quotes.forEach((quote) => {
    const date = timestampToDate(quote.acceptedAt) ?? timestampToDate(quote.updatedAt)
    if (!date) return
    const bucket = findBucket(date, buckets)
    if (!bucket) return
    bucket.value += quote.total || 0
  })

  return buckets.map((bucket) => ({ label: bucket.label, value: bucket.value }))
}

function buildQuoteComparisonSeries(
  sentQuotes: Quote[],
  wonQuotes: Quote[],
  range: DateRange,
): SalesComparisonPoint[] {
  const buckets = buildBuckets(range)

  sentQuotes.forEach((quote) => {
    const date = timestampToDate(quote.createdAt)
    if (!date) return
    const bucket = findBucket(date, buckets)
    if (!bucket) return
    bucket.sent += 1
  })

  wonQuotes.forEach((quote) => {
    const date = timestampToDate(quote.acceptedAt) ?? timestampToDate(quote.updatedAt)
    if (!date) return
    const bucket = findBucket(date, buckets)
    if (!bucket) return
    bucket.won += 1
  })

  return buckets.map((bucket) => ({
    label: bucket.label,
    sent: bucket.sent,
    won: bucket.won,
  }))
}

function buildRepLeaderboard(
  sentQuotes: Quote[],
  wonQuotes: Quote[],
  usersById: Map<string, AppUser>,
): SalesRepLeaderboardEntry[] {
  const summary = new Map<string, SalesRepLeaderboardEntry>()

  sentQuotes.forEach((quote) => {
    const repId = quote.createdBy || 'unassigned'
    const existing = summary.get(repId) ?? {
      repId,
      repName: resolveRepName(repId, usersById),
      wonRevenue: 0,
      quotesSent: 0,
      winRate: 0,
    }
    existing.quotesSent += 1
    summary.set(repId, existing)
  })

  wonQuotes.forEach((quote) => {
    const repId = quote.createdBy || 'unassigned'
    const existing = summary.get(repId) ?? {
      repId,
      repName: resolveRepName(repId, usersById),
      wonRevenue: 0,
      quotesSent: 0,
      winRate: 0,
    }
    existing.wonRevenue += quote.total || 0
    summary.set(repId, existing)
  })

  return [...summary.values()]
    .map((entry) => {
      const repWins = wonQuotes.filter((quote) => quote.createdBy === entry.repId).length
      return {
        ...entry,
        winRate: entry.quotesSent > 0 ? repWins / entry.quotesSent : 0,
      }
    })
    .sort((left, right) => right.wonRevenue - left.wonRevenue || right.quotesSent - left.quotesSent)
    .slice(0, 5)
}

function buildCompanyLeaderboard(
  sentQuotes: Quote[],
  wonQuotes: Quote[],
  customersById: Map<string, Customer>,
  leadsById: Map<string, Lead>,
): SalesCompanyLeaderboardEntry[] {
  const summary = new Map<string, SalesCompanyLeaderboardEntry>()

  const touch = (quote: Quote, isWon: boolean) => {
    const company = resolveQuoteCompany(quote, customersById, leadsById)
    const existing = summary.get(company) ?? {
      company,
      totalQuoted: 0,
      totalWon: 0,
      lastActivity: null,
    }

    existing.totalQuoted += quote.total || 0
    if (isWon) existing.totalWon += quote.total || 0

    const activityDate =
      timestampToDate(quote.acceptedAt) ?? timestampToDate(quote.updatedAt) ?? timestampToDate(quote.createdAt)
    if (activityDate && (!existing.lastActivity || activityDate > existing.lastActivity)) {
      existing.lastActivity = activityDate
    }

    summary.set(company, existing)
  }

  sentQuotes.forEach((quote) => touch(quote, false))
  wonQuotes.forEach((quote) => touch(quote, true))

  return [...summary.values()]
    .sort((left, right) => right.totalWon - left.totalWon || right.totalQuoted - left.totalQuoted)
    .slice(0, 5)
}

function resolveLeadCompany(lead: Lead): string {
  return lead.company?.trim() || lead.name?.trim() || 'Unassigned account'
}

function resolveQuoteCompany(
  quote: Quote,
  customersById: Map<string, Customer>,
  leadsById: Map<string, Lead>,
): string {
  if (quote.customerId) {
    return customersById.get(quote.customerId)?.name ?? quote.customerId
  }

  if (quote.leadId) {
    const lead = leadsById.get(quote.leadId)
    if (lead) return resolveLeadCompany(lead)
    return quote.leadId
  }

  return 'Unassigned account'
}

function resolveRepName(repId: string, usersById: Map<string, AppUser>): string {
  return usersById.get(repId)?.name ?? (repId === 'unassigned' ? 'Unassigned' : 'Unknown rep')
}

interface DateRange {
  start: Date
  end: Date
}

interface Bucket {
  start: Date
  end: Date
  label: string
  value: number
  sent: number
  won: number
}

function getDateRange(filters: SalesDashboardFilters): DateRange {
  const fallback = getSalesDashboardPresetRange('last30')
  return {
    start: startOfDay(parseDate(filters.startDate || fallback.startDate)),
    end: endOfDay(parseDate(filters.endDate || fallback.endDate)),
  }
}

function buildBuckets(range: DateRange): Bucket[] {
  const daySpan = Math.max(1, Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000) + 1)
  const mode = daySpan <= 14 ? 'day' : daySpan <= 90 ? 'week' : 'month'
  const buckets: Bucket[] = []
  let cursor = new Date(range.start)

  while (cursor <= range.end) {
    const bucketStart = new Date(cursor)
    let bucketEnd: Date
    let label: string

    if (mode === 'day') {
      bucketEnd = endOfDay(bucketStart)
      label = bucketStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      cursor = addDays(bucketStart, 1)
    } else if (mode === 'week') {
      bucketEnd = endOfDay(addDays(bucketStart, 6))
      if (bucketEnd > range.end) bucketEnd = new Date(range.end)
      label = bucketStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      cursor = addDays(bucketStart, 7)
    } else {
      bucketStart.setDate(1)
      bucketEnd = endOfDay(new Date(bucketStart.getFullYear(), bucketStart.getMonth() + 1, 0))
      if (bucketEnd > range.end) bucketEnd = new Date(range.end)
      label = bucketStart.toLocaleDateString('en-US', { month: 'short' })
      cursor = new Date(bucketStart.getFullYear(), bucketStart.getMonth() + 1, 1)
    }

    buckets.push({ start: bucketStart, end: bucketEnd, label, value: 0, sent: 0, won: 0 })
  }

  return buckets
}

function findBucket(date: Date, buckets: Bucket[]): Bucket | undefined {
  return buckets.find((bucket) => date >= bucket.start && date <= bucket.end)
}

function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, Math.max(0, month - 1), day || 1)
}

function timestampToDate(value: { toDate(): Date } | undefined): Date | null {
  if (!value) return null
  return value.toDate()
}

function startOfDay(value: Date): Date {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

function endOfDay(value: Date): Date {
  const date = new Date(value)
  date.setHours(23, 59, 59, 999)
  return date
}

function addDays(value: Date, amount: number): Date {
  const date = new Date(value)
  date.setDate(date.getDate() + amount)
  return date
}

function isInRange(value: Date | null, range: DateRange): boolean {
  if (!value) return false
  return value >= range.start && value <= range.end
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}