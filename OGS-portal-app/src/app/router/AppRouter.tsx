import React from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { ROLE_HOME } from '../../types/auth'
import { ProtectedRoute } from '../guards/ProtectedRoute'
import { AdminLayout } from '../../components/layouts/AdminLayout'
import {
  AgingPage,
  CrmBillingPage,
  CrmLayout,
  CustomerRecord,
  CustomersPage,
  LeadsPage,
  MerchandisingPanel,
  PriceList,
  QuoteEditorPage,
  QuotesPage,
  SalesDashboardPage,
} from '../../features/crm'
import {
  DispatchPage,
  InventoryPage,
  OpsDashboardPage,
  OpsLayout,
  OpsOrdersPage,
  OpsTanksPage,
  RunBuilder,
  RunSummaryPage,
  RunsPage,
} from '../../features/operations'
import {
  CompanyProfilePage,
  CustomerLayout,
  DashboardPage,
  InvoicesPage,
  MyProducts,
  OrderPage,
  OrdersPage,
  ProfilePage,
  QuotePage,
  TankLevelsPage,
} from '../../features/customer'
import {
  CapturePage,
  DriverLayout,
  SchedulePage,
  StopPage,
  TruckLoadPage,
  TruckPage,
} from '../../features/driver'
import { LoginPage, ResetPasswordPage } from '../../features/auth'
import { AdminDashboard, CompanySettingsPage, DeliverySettingsPage, UserManagement, EmailTemplatesPage } from '../../features/admin'

import BillingDashboard from '../../pages/billing/BillingDashboard'

// New Order module
import NewOrderPage from '../../modules/orders/new/NewOrderPage'

// Onboarding
import SignUp from '../../pages/public/SignUp'
import OnboardingPage from '../../pages/portal/Onboarding'
import AcceptInvitePage from '../../pages/portal/AcceptInvite'
import JoinSetupPage from '../../pages/portal/JoinSetup'
import TeamSettingsPage from '../../pages/portal/TeamSettings'
import { OnboardingLayout } from '../../components/layouts/OnboardingLayout'

// Ops customer views
import CustomerListPage   from '../../pages/ops/CustomerList'
import CustomerDetailPage from '../../pages/ops/CustomerDetail'

// Public quote acceptance (no auth required)
import PublicQuotePage from '../../pages/public/PublicQuotePage'
import QuickActionsPage from '../../pages/quick-actions/QuickActionsPage'



const RootRedirect: React.FC = () => {
  const { user, loading, role } = useAuth()

  if (loading) {
    return <div className="layout-loading"><span className="layout-loading__spinner" /></div>
  }
  if (!user || !role) return <Navigate to="/login" replace />
  return <Navigate to={ROLE_HOME[role]} replace />
}

export const AppRouter: React.FC = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<RootRedirect />} />

      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />

      {/* Public quote acceptance — no auth required, token in query string */}
      <Route path="/quote/:quoteId" element={<PublicQuotePage />} />

      {/* Customer account setup via QR code — no auth required */}
      <Route path="/join/:token" element={<JoinSetupPage />} />

      {/* Onboarding wizard — minimal layout, no sidebar */}
      <Route
        path="/portal/onboarding"
        element={
          <ProtectedRoute role={['owner', 'manager', 'billing', 'delivery', 'viewer', 'customer', 'admin']}>
            <OnboardingLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<OnboardingPage />} />
      </Route>

      <Route
        path="/quick-actions"
        element={
          <ProtectedRoute role={['admin', 'sales', 'driver', 'dispatch']}>
            <QuickActionsPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/portal"
        element={
          <ProtectedRoute role={['customer', 'owner', 'manager', 'billing', 'delivery', 'viewer', 'admin']}>
            <CustomerLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="order" element={<OrderPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="invoices" element={<InvoicesPage />} />
        <Route path="tanks" element={<TankLevelsPage />} />
        <Route path="catalog" element={<MyProducts />} />
        <Route path="quotes/:quoteId" element={<QuotePage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="company" element={<CompanyProfilePage />} />
        <Route path="settings/team" element={<TeamSettingsPage />} />
      </Route>

      <Route
        path="/ops"
        element={
          <ProtectedRoute role={['admin', 'dispatch', 'sales', 'driver']}>
            <OpsLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<OpsDashboardPage />} />
        <Route path="orders" element={<OpsOrdersPage />} />
        <Route path="runs" element={<RunsPage />} />
        <Route path="runs/new" element={<RunBuilder />} />
        <Route path="runs/:runId/summary" element={<RunSummaryPage />} />
        <Route path="dispatch" element={<DispatchPage />} />
        <Route path="dispatch/:runId" element={<DispatchPage />} />
        <Route path="tanks" element={<OpsTanksPage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="billing" element={<BillingDashboard />} />
        <Route path="customers" element={<CustomerListPage />} />
        <Route path="customers/:companyId" element={<CustomerDetailPage />} />
      </Route>


      <Route
        path="/driver"
        element={
          <ProtectedRoute role={['driver', 'admin']}>
            <DriverLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="schedule" replace />} />
        <Route path="schedule" element={<SchedulePage />} />
        <Route path="stop/:id" element={<StopPage />} />
        <Route path="capture/:id" element={<CapturePage />} />
        <Route path="summary/:runId" element={<StopPage />} />
        <Route path="truck" element={<TruckPage />} />
        <Route
          path="load/:runId"
          element={
            <ProtectedRoute role={['driver', 'dispatch', 'admin']}>
              <TruckLoadPage />
            </ProtectedRoute>
          }
        />
      </Route>

      <Route
        path="/crm"
        element={
          <ProtectedRoute role={['admin', 'sales']}>
            <CrmLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<SalesDashboardPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/:customerId" element={<CustomerRecord />} />
        <Route path="leads" element={<LeadsPage />} />
        <Route path="quotes" element={<QuotesPage />} />
        <Route path="quotes/new" element={<QuoteEditorPage />} />
        <Route path="quotes/:quoteId" element={<QuoteEditorPage />} />
        <Route path="billing" element={<CrmBillingPage />} />
        <Route path="aging" element={<AgingPage />} />
        <Route path="price-list" element={<PriceList />} />
        <Route path="merchandising" element={<MerchandisingPanel />} />
      </Route>

      <Route
        path="/admin"
        element={
          <ProtectedRoute role="admin">
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboard />} />
        <Route path="users" element={<UserManagement />} />
        <Route path="delivery-settings" element={<DeliverySettingsPage />} />
        <Route path="company-settings"  element={<CompanySettingsPage />} />
        <Route path="email-templates"   element={<EmailTemplatesPage />} />

        {/* CRM pages inside AdminLayout */}
        <Route path="crm" element={<Navigate to="dashboard" replace />} />
        <Route path="crm/dashboard"                    element={<SalesDashboardPage />} />
        <Route path="crm/customers"                    element={<CustomersPage />} />
        <Route path="crm/customers/:customerId"        element={<CustomerRecord />} />
        <Route path="crm/leads"                        element={<LeadsPage />} />
        <Route path="crm/quotes"                       element={<QuotesPage />} />
        <Route path="crm/quotes/new"                   element={<QuoteEditorPage />} />
        <Route path="crm/quotes/:quoteId"              element={<QuoteEditorPage />} />
        <Route path="crm/billing"                      element={<CrmBillingPage />} />
        <Route path="crm/aging"                        element={<AgingPage />} />
        <Route path="crm/price-list"                   element={<PriceList />} />
        <Route path="crm/merchandising"                element={<MerchandisingPanel />} />

        {/* Ops pages inside AdminLayout */}
        <Route path="ops" element={<Navigate to="dashboard" replace />} />
        <Route path="ops/dashboard"                    element={<OpsDashboardPage />} />
        <Route path="ops/orders"                       element={<OpsOrdersPage />} />
        <Route path="ops/runs"                         element={<RunsPage />} />
        <Route path="ops/runs/new"                     element={<RunBuilder />} />
        <Route path="ops/runs/:runId/summary"          element={<RunSummaryPage />} />
        <Route path="ops/dispatch"                     element={<DispatchPage />} />
        <Route path="ops/dispatch/:runId"              element={<DispatchPage />} />
        <Route path="ops/tanks"                        element={<OpsTanksPage />} />
        <Route path="ops/inventory"                    element={<InventoryPage />} />
        <Route path="ops/billing"                      element={<BillingDashboard />} />
        <Route path="ops/customers"                    element={<CustomerListPage />} />
        <Route path="ops/customers/:companyId"         element={<CustomerDetailPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />

      <Route
        path="/orders/new"
        element={
          <ProtectedRoute role={['customer', 'dispatch', 'admin', 'sales']}>
            <NewOrderPage />
          </ProtectedRoute>
        }
      />
    </Routes>
  </BrowserRouter>
)

export const Router = AppRouter
