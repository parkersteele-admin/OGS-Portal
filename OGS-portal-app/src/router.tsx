import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { ROLE_HOME } from './types/auth'
import { ProtectedRoute } from './components/ProtectedRoute'
import { CustomerLayout } from './components/layouts/CustomerLayout'
import { OpsLayout } from './components/layouts/OpsLayout'
import { DriverLayout } from './components/layouts/DriverLayout'
import { CrmLayout } from './components/layouts/CrmLayout'
import { AdminLayout } from './components/layouts/AdminLayout'

// Auth
import LoginPage from './pages/auth/Login'
import ResetPasswordPage from './pages/auth/ResetPassword'

// Customer
import DashboardPage from './pages/customer/DashboardPage'
import OrderPage from './pages/customer/OrderPage'
import OrdersPage from './pages/customer/OrdersPage'
import InvoicesPage from './pages/customer/InvoicesPage'
import PayInvoicePage from './pages/customer/PayInvoicePage'
import ManageAutopay from './pages/customer/ManageAutopay'
import TankLevelsPage from './pages/customer/TankLevels'

// Ops / Dispatch
import OpsDashboardPage from './pages/dispatch/OpsDashboard'
import OpsOrdersPage from './pages/dispatch/OpsOrdersPage'
import RunsPage from './pages/dispatch/RunsPage'
import RunBuilder from './pages/dispatch/RunBuilder'
import RunSummaryPage from './pages/dispatch/RunSummary'
import DispatchPage from './pages/dispatch/DispatchPage'
import OpsTanksPage from './pages/dispatch/OpsTanksPage'
import InventoryPage from './pages/dispatch/InventoryPage'

// Driver
import SchedulePage from './pages/driver/SchedulePage'
import StopPage from './pages/driver/StopPage'
import CapturePage from './pages/driver/CapturePage'

// CRM
import CustomersPage from './pages/crm/CustomersPage'
import CustomerRecord from './pages/crm/CustomerRecord'
import LeadsPage from './pages/crm/LeadsPage'
import QuotesPage from './pages/crm/QuotesPage'
import QuoteEditorPage from './pages/crm/QuoteEditorPage'
import CrmBillingPage from './pages/crm/CrmBillingPage'
import AgingPage from './pages/crm/AgingPage'
import PriceList from './pages/crm/PriceList'
import MerchandisingPanel from './pages/crm/MerchandisingPanel'
import BillingDashboard from './pages/billing/BillingDashboard'
import UserManagement from './pages/admin/UserManagement'

// Customer catalog
import ProductCatalog from './pages/customer/ProductCatalog'

// ── Root redirect: auth-aware, sends each role to their home ─────────────────
const RootRedirect: React.FC = () => {
  const { user, loading, role } = useAuth()

  if (loading) {
    return <div className="layout-loading"><span className="layout-loading__spinner" /></div>
  }
  if (!user || !role) return <Navigate to="/login" replace />
  return <Navigate to={ROLE_HOME[role]} replace />
}

export const Router: React.FC = () => (
  <BrowserRouter>
    <Routes>
      {/* Root */}
      <Route path="/" element={<RootRedirect />} />

      {/* Public */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* Customer Portal */}
      <Route
        path="/portal"
        element={
          <ProtectedRoute role={['customer', 'admin']}>
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
      </Route>

      {/* Ops Portal */}
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
      </Route>

      {/* Driver Portal */}
      <Route
        path="/driver"
        element={
          <ProtectedRoute role="driver">
            <DriverLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="schedule" replace />} />
        <Route path="schedule" element={<SchedulePage />} />
        <Route path="stop/:id" element={<StopPage />} />
        <Route path="capture/:id" element={<CapturePage />} />
        <Route path="summary/:runId" element={<StopPage />} />
      </Route>

      {/* CRM Portal */}
      <Route
        path="/crm"
        element={
          <ProtectedRoute role={['admin', 'sales']}>
            <CrmLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="customers" replace />} />
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

      {/* Admin Portal */}
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
      </Route>

      {/* 404 fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </BrowserRouter>
)
