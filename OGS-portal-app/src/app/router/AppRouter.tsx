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
  CustomerLayout,
  DashboardPage,
  InvoicesPage,
  ManageAutopay,
  OrderPage,
  OrdersPage,
  PayInvoicePage,
  ProductCatalog,
  ProfilePage,
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
import { DeliverySettingsPage, UserManagement } from '../../features/admin'

import BillingDashboard from '../../pages/billing/BillingDashboard'

// New Order module
import NewOrderPage from '../../modules/orders/new/NewOrderPage'

// Onboarding
import SignUp from '../../pages/public/SignUp'
import OnboardingPage from '../../pages/portal/Onboarding'
import AcceptInvitePage from '../../pages/portal/AcceptInvite'
import TeamSettingsPage from '../../pages/portal/TeamSettings'
import { OnboardingLayout } from '../../components/layouts/OnboardingLayout'

// Ops customer views
import CustomerListPage   from '../../pages/ops/CustomerList'
import CustomerDetailPage from '../../pages/ops/CustomerDetail'

// Sales Pipeline
import { SalesLayout } from '../../components/layouts/SalesLayout'
import SalesDashboard   from '../../pages/ops/sales/SalesDashboard'
import PipelineList     from '../../pages/ops/sales/PipelineList'
import WonAccounts      from '../../pages/ops/sales/WonAccounts'
import LostLeads        from '../../pages/ops/sales/LostLeads'
import SalesPerformance from '../../pages/ops/sales/SalesPerformance'

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
        <Route path="invoices/:invoiceId/pay" element={<PayInvoicePage />} />
        <Route path="autopay" element={<ManageAutopay />} />
        <Route path="tanks" element={<TankLevelsPage />} />
        <Route path="catalog" element={<ProductCatalog />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="settings/team" element={<TeamSettingsPage />} />
      </Route>

      <Route
        path="/ops"
        element={
          <ProtectedRoute role={['admin', 'dispatch']}>
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

      {/* Sales Pipeline — admin + sales */}
      <Route
        path="/ops/sales"
        element={
          <ProtectedRoute role={['admin', 'sales']}>
            <SalesLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard"   element={<SalesDashboard />} />
        <Route path="pipeline"    element={<PipelineList />} />
        <Route path="won"         element={<WonAccounts />} />
        <Route path="lost"        element={<LostLeads />} />
        <Route path="performance" element={<SalesPerformance />} />
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
        <Route index element={<Navigate to="users" replace />} />
        <Route path="users" element={<UserManagement />} />
        <Route path="delivery-settings" element={<DeliverySettingsPage />} />
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
