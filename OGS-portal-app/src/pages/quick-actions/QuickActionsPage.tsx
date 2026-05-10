import { type ReactElement, useEffect, useMemo, useState } from 'react'
import { Timestamp, collection, getDocs, query, where } from 'firebase/firestore'
import {
	AlertTriangle,
	BarChart2,
	CalendarDays,
	CheckCircle,
	ClipboardList,
	Droplets,
	FileStack,
	FileText,
	Map,
	MapPin,
	Menu,
	MessageSquare,
	Phone,
	Tag,
	Truck,
	UserCheck,
	UserPlus,
	type LucideIcon,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { db } from '../../lib/firebase'
import type { OgsRole } from '../../types/user'
import './QuickActionsPage.css'

type StatTone = 'positive' | 'warning' | 'neutral'

interface QuickStat {
	label: string
	value: string
	delta: string
	tone: StatTone
}

interface QuickTile {
	label: string
	sub: string
	icon: LucideIcon
	to: string
	primary?: boolean
}

interface DrawerLink {
	label: string
	to: string
}

const ROLE_ORDER: OgsRole[] = ['admin', 'sales', 'dispatch', 'driver']

const ROLE_TILES: Record<OgsRole, QuickTile[]> = {
	admin: [
		{ label: 'New Customer', sub: 'Create company profile', icon: UserPlus, to: '/admin/crm/customers', primary: true },
		{ label: 'New Quote', sub: 'Build and send quote', icon: FileText, to: '/admin/crm/quotes' },
		{ label: 'Dispatch Board', sub: 'Assign routes', icon: Truck, to: '/admin/ops/dispatch' },
		{ label: 'Billing', sub: 'Review invoices', icon: ClipboardList, to: '/admin/billing' },
		{ label: 'KPI Snapshot', sub: 'View performance trends', icon: BarChart2, to: '/admin/dashboard' },
		{ label: 'Manage Pricing', sub: 'Update product tags', icon: Tag, to: '/admin/company-settings' },
	],
	sales: [
		{ label: 'New Lead', sub: 'Capture prospect', icon: UserPlus, to: '/crm/leads', primary: true },
		{ label: 'Create Quote', sub: 'Draft quote', icon: FileText, to: '/crm/quotes' },
		{ label: 'Quote Stack', sub: 'Manage revisions', icon: FileStack, to: '/crm/quotes' },
		{ label: 'Aging', sub: 'Follow up AR', icon: BarChart2, to: '/crm/aging' },
		{ label: 'Price List', sub: 'Review product tags', icon: Tag, to: '/crm/price-list' },
		{ label: 'Call Queue', sub: 'Daily follow-up calls', icon: Phone, to: '/crm/leads' },
	],
	dispatch: [
		{ label: 'Orders Queue', sub: 'Queue and triage', icon: ClipboardList, to: '/ops/orders', primary: true },
		{ label: 'Driver Check-In', sub: 'Confirm assignment status', icon: UserCheck, to: '/ops/runs' },
		{ label: 'Gallons Watch', sub: 'Track delivered volume', icon: Droplets, to: '/ops/dashboard' },
		{ label: 'Completion Board', sub: 'Resolve exceptions', icon: CheckCircle, to: '/ops/dashboard' },
		{ label: 'Dispatch Map', sub: 'View active drivers', icon: Map, to: '/ops/dispatch' },
	],
	driver: [
		{ label: 'Today Run', sub: 'Open current schedule', icon: CalendarDays, to: '/driver/schedule', primary: true },
		{ label: 'Stop Completion', sub: 'Mark completed deliveries', icon: CheckCircle, to: '/driver/schedule' },
		{ label: 'Dispatch Map', sub: 'Navigation and status', icon: MapPin, to: '/ops/dispatch' },
		{ label: 'Issue Alert', sub: 'Flag delivery exceptions', icon: AlertTriangle, to: '/ops/orders' },
		{ label: 'Driver Notes', sub: 'Send dispatch updates', icon: MessageSquare, to: '/driver/truck' },
	],
}

const ROLE_DRAWER_LINKS: Record<OgsRole, DrawerLink[]> = {
	admin: [
		{ label: 'Dashboard', to: '/admin/dashboard' },
		{ label: 'Customers', to: '/admin/crm/customers' },
		{ label: 'Quotes', to: '/admin/crm/quotes' },
		{ label: 'Operations', to: '/admin/ops/dispatch' },
		{ label: 'Users', to: '/admin/users' },
	],
	sales: [
		{ label: 'Dashboard', to: '/crm/dashboard' },
		{ label: 'Leads', to: '/crm/leads' },
		{ label: 'Customers', to: '/crm/customers' },
		{ label: 'Quotes', to: '/crm/quotes' },
		{ label: 'Billing', to: '/crm/billing' },
	],
	dispatch: [
		{ label: 'Dashboard', to: '/ops/dashboard' },
		{ label: 'Dispatch', to: '/ops/dispatch' },
		{ label: 'Orders', to: '/ops/orders' },
		{ label: 'Runs', to: '/ops/runs' },
	],
	driver: [
		{ label: 'Schedule', to: '/driver/schedule' },
		{ label: 'Dispatch Map', to: '/ops/dispatch' },
		{ label: 'Truck', to: '/driver/truck' },
	],
}

function startOfDay(date = new Date()): Date {
	const next = new Date(date)
	next.setHours(0, 0, 0, 0)
	return next
}

function endOfDay(date = new Date()): Date {
	const next = new Date(startOfDay(date))
	next.setDate(next.getDate() + 1)
	return next
}

function startOfWeek(date = new Date()): Date {
	const next = new Date(startOfDay(date))
	const weekday = next.getDay()
	const offset = weekday === 0 ? -6 : 1 - weekday
	next.setDate(next.getDate() + offset)
	return next
}

function endOfWeek(date = new Date()): Date {
	const next = new Date(startOfWeek(date))
	next.setDate(next.getDate() + 7)
	return next
}

function toDate(value: unknown): Date | null {
	if (!value) return null
	if (value instanceof Date) return value
	if (typeof value === 'number') return new Date(value)
	if (typeof value === 'object' && value && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
		return (value as { toDate: () => Date }).toDate()
	}
	return null
}

function formatCurrency(value: number): string {
	return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function useQuickStats(role: OgsRole, userId: string | null): { stats: QuickStat[] | null; isLoading: boolean } {
	const [stats, setStats] = useState<QuickStat[] | null>([])
	const [isLoading, setIsLoading] = useState(true)

	useEffect(() => {
		let cancelled = false

		async function run(): Promise<void> {
			setIsLoading(true)
			setStats([])

			try {
				const now = new Date()
				const dayStart = Timestamp.fromDate(startOfDay(now))
				const dayEnd = Timestamp.fromDate(endOfDay(now))
				const weekStart = Timestamp.fromDate(startOfWeek(now))
				const weekEnd = Timestamp.fromDate(endOfWeek(now))

				let nextStats: QuickStat[] = []

				if (role === 'admin') {
					const paidSnap = await getDocs(
						query(
							collection(db, 'invoices'),
							where('paidAt', '>=', dayStart),
							where('paidAt', '<', dayEnd),
						),
					)
					const paidDocs = paidSnap.docs.filter((docSnap) => (docSnap.data() as { status?: unknown }).status === 'paid')
					const paidCount = paidDocs.length
					const paidRevenue = paidDocs.reduce((sum, docSnap) => {
						const total = Number((docSnap.data() as { total?: unknown }).total)
						return Number.isFinite(total) ? sum + total : sum
					}, 0)

					const openQuotesSnap = await getDocs(collection(db, 'quotes'))
					const openQuotes = openQuotesSnap.docs.filter((docSnap) => {
						const status = (docSnap.data() as { status?: unknown }).status
						const validUntil = toDate((docSnap.data() as { validUntil?: unknown }).validUntil)
						return (status === 'draft' || status === 'sent') && (!validUntil || validUntil >= now)
					}).length

					nextStats = [
						{ label: 'Paid today', value: String(paidCount), delta: `${formatCurrency(paidRevenue)} collected`, tone: 'positive' },
						{ label: 'Open quotes', value: String(openQuotes), delta: 'Draft and sent pipeline', tone: 'neutral' },
					]
				}

				if (role === 'sales') {
					if (!userId) {
						nextStats = [
							{ label: 'My open quotes', value: '--', delta: 'Unavailable', tone: 'warning' },
							{ label: 'Accepted this week', value: '--', delta: 'Unavailable', tone: 'warning' },
						]
					} else {
						const myQuotesSnap = await getDocs(query(collection(db, 'quotes'), where('createdBy', '==', userId)))
						const myOpen = myQuotesSnap.docs.filter((docSnap) => {
							const status = (docSnap.data() as { status?: unknown }).status
							const validUntil = toDate((docSnap.data() as { validUntil?: unknown }).validUntil)
							return (status === 'draft' || status === 'sent') && (!validUntil || validUntil >= now)
						}).length

						const acceptedThisWeek = myQuotesSnap.docs.filter((docSnap) => {
							const data = docSnap.data() as { status?: unknown; acceptedAt?: unknown }
							const acceptedAt = toDate(data.acceptedAt)
							return data.status === 'accepted' && acceptedAt !== null && acceptedAt >= weekStart.toDate() && acceptedAt < weekEnd.toDate()
						}).length

						nextStats = [
							{ label: 'My open quotes', value: String(myOpen), delta: 'Active ownership only', tone: 'neutral' },
							{ label: 'Accepted this week', value: String(acceptedThisWeek), delta: 'Mon-Sun conversion count', tone: 'positive' },
						]
					}
				}

				if (role === 'dispatch') {
					const pendingSnap = await getDocs(collection(db, 'orders'))
					const pendingOrders = pendingSnap.docs.filter((docSnap) => {
						const status = (docSnap.data() as { status?: unknown }).status
						return status === 'pending' || status === 'scheduled' || status === 'assigned'
					}).length

					const activeRunsSnap = await getDocs(
						query(
							collection(db, 'runs'),
							where('scheduledDate', '>=', dayStart),
							where('scheduledDate', '<', dayEnd),
						),
					)

					const activeDrivers = new Set(
						activeRunsSnap.docs
							.filter((docSnap) => {
								const status = (docSnap.data() as { status?: unknown }).status
								return status === 'scheduled' || status === 'in-progress'
							})
							.map((docSnap) => (docSnap.data() as { driverId?: unknown }).driverId)
							.filter((driverId): driverId is string => typeof driverId === 'string' && driverId.length > 0),
					).size

					nextStats = [
						{ label: 'Pending orders', value: String(pendingOrders), delta: 'Pending, scheduled, assigned', tone: 'warning' },
						{ label: 'Active drivers', value: String(activeDrivers), delta: 'Drivers with runs today', tone: 'neutral' },
					]
				}

				if (role === 'driver') {
					if (!userId) {
						nextStats = [
							{ label: 'Delivered today', value: '--', delta: 'Unavailable', tone: 'warning' },
							{ label: 'Run gallons', value: '--', delta: 'Unavailable', tone: 'warning' },
						]
					} else {
						const deliveredSnap = await getDocs(
							query(
								collection(db, 'orders'),
								where('signedAt', '>=', dayStart),
								where('signedAt', '<', dayEnd),
							),
						)
						const deliveredCount = deliveredSnap.docs.filter((docSnap) => (docSnap.data() as { signedByUid?: unknown }).signedByUid === userId).length

						const runsSnap = await getDocs(
							query(
								collection(db, 'runs'),
								where('scheduledDate', '>=', dayStart),
								where('scheduledDate', '<', dayEnd),
							),
						)
						const driverRuns = runsSnap.docs.filter((docSnap) => (docSnap.data() as { driverId?: unknown }).driverId === userId)

						const totalStops = driverRuns.reduce((sum, docSnap) => {
							const stopIds = (docSnap.data() as { stopIds?: unknown }).stopIds
							return Array.isArray(stopIds) ? sum + stopIds.length : sum
						}, 0)

						const gallonValues = driverRuns
							.map((docSnap) => Number((docSnap.data() as { totalGallons?: unknown }).totalGallons))
							.filter((value) => Number.isFinite(value))
						const gallonsKnown = gallonValues.length > 0
						const totalGallons = gallonValues.reduce((sum, value) => sum + value, 0)

						nextStats = [
							{ label: 'Delivered today', value: String(deliveredCount), delta: `${totalStops} planned stops today`, tone: 'positive' },
							{
								label: 'Run gallons',
								value: gallonsKnown ? `${Math.round(totalGallons)}` : '--',
								delta: gallonsKnown ? 'From run manifests' : 'Unavailable',
								tone: gallonsKnown ? 'neutral' : 'warning',
							},
						]
					}
				}

				if (!cancelled) {
					setStats(nextStats)
					setIsLoading(false)
				}
			} catch {
				if (!cancelled) {
					setStats(null)
					setIsLoading(false)
				}
			}
		}

		void run()

		return () => {
			cancelled = true
		}
	}, [role, userId])

	return { stats, isLoading }
}

export default function QuickActionsPage(): ReactElement {
	const navigate = useNavigate()
	const { role, user } = useAuth()
	const [drawerOpen, setDrawerOpen] = useState(false)
	const [activeRole, setActiveRole] = useState<OgsRole>('dispatch')

	useEffect(() => {
		if (role === 'admin' || role === 'sales' || role === 'dispatch' || role === 'driver') {
			setActiveRole(role)
		}
	}, [role])

	const statsRole = activeRole
	const statsUserId = role === activeRole ? (user?.id ?? null) : null
	const { stats, isLoading } = useQuickStats(statsRole, statsUserId)

	const tiles = useMemo(() => ROLE_TILES[activeRole], [activeRole])
	const drawerLinks = useMemo(() => ROLE_DRAWER_LINKS[activeRole], [activeRole])

	return (
		<div className="qa-page">
			<button
				type="button"
				className={`qa-drawer-backdrop${drawerOpen ? ' qa-drawer-backdrop--open' : ''}`}
				onClick={() => setDrawerOpen(false)}
				aria-label="Close quick actions menu"
			/>
			<aside className={`qa-drawer${drawerOpen ? ' qa-drawer--open' : ''}`}>
				<div className="qa-drawer__head">Quick links</div>
				<div className="qa-drawer__links">
					{drawerLinks.map((link) => (
						<button
							type="button"
							key={link.to}
							className="qa-drawer__link"
							onClick={() => {
								setDrawerOpen(false)
								navigate(link.to)
							}}
						>
							{link.label}
						</button>
					))}
				</div>
			</aside>

			<header className="qa-topbar">
				<button type="button" className="qa-menu" onClick={() => setDrawerOpen(true)} aria-label="Open quick links">
					<Menu size={22} color="#ffffff" />
				</button>
				<div className="qa-wordmark">OGS Quick Actions</div>
				<div className="qa-role-badge">{activeRole}</div>
			</header>

			<section className="qa-greeting">
				<p>{user?.name ? `Hello, ${user.name}` : 'Hello'}</p>
				<h1>Fast actions for {activeRole}</h1>
			</section>

			{role === 'admin' && (
				<section className="qa-role-tabs" aria-label="Role preview">
					{ROLE_ORDER.map((previewRole) => (
						<button
							type="button"
							key={previewRole}
							className={`qa-role-tab${previewRole === activeRole ? ' qa-role-tab--active' : ''}`}
							onClick={() => setActiveRole(previewRole)}
						>
							{previewRole}
						</button>
					))}
				</section>
			)}

			<div className="qa-section-label">Actions</div>
			<section className="qa-grid" aria-label="Quick actions grid">
				{tiles.map((tile) => (
					<button
						type="button"
						key={`${activeRole}-${tile.label}`}
						className={`qa-tile${tile.primary ? ' qa-tile--primary' : ''}`}
						onClick={() => navigate(tile.to)}
					>
						<span className="qa-tile__icon" aria-hidden="true"><tile.icon size={24} color={tile.primary ? '#ffffff' : '#FF6B1A'} /></span>
						<span className="qa-tile__label">{tile.label}</span>
						<span className="qa-tile__sub">{tile.sub}</span>
					</button>
				))}
			</section>

			<div className="qa-section-label" style={{ marginTop: '14px' }}>Stats</div>
			<section className="qa-stats" aria-label="Quick stats strip">
				{isLoading && (
					<div className="qa-stat-card">
						<div className="qa-stat-card__value">...</div>
						<div className="qa-stat-card__label">Loading stats</div>
						<div className="qa-stat-card__delta">Please wait</div>
					</div>
				)}

				{!isLoading && stats === null && (
					<div className="qa-stat-card">
						<div className="qa-stat-card__value">--</div>
						<div className="qa-stat-card__label">Unavailable</div>
					</div>
				)}

				{!isLoading && stats !== null && stats.map((stat) => (
					<div className="qa-stat-card" key={stat.label}>
						<div className="qa-stat-card__value">{stat.value}</div>
						<div className="qa-stat-card__label">{stat.label}</div>
						<div
							className={
								stat.tone === 'positive'
									? 'qa-stat-card__delta qa-stat-card__delta--positive'
									: stat.tone === 'warning'
										? 'qa-stat-card__delta qa-stat-card__delta--warning'
										: 'qa-stat-card__delta'
							}
						>
							{stat.delta}
						</div>
					</div>
				))}
			</section>
		</div>
	)
}
