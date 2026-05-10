import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';

// Lazy-loaded pages — each becomes its own JS chunk
const LoginPage = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const SignupPage = lazy(() => import('./pages/SignupPage').then(m => ({ default: m.SignupPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const ArchivedDashboardPage = lazy(() => import('./pages/ArchivedDashboardPage').then(m => ({ default: m.ArchivedDashboardPage })));
const JobBrowserPage = lazy(() => import('./pages/JobBrowserPage').then(m => ({ default: m.JobBrowserPage })));
const WizardPage = lazy(() => import('./pages/WizardPage').then(m => ({ default: m.WizardPage })));
const ClientPortalPage = lazy(() => import('./pages/ClientPortalPage').then(m => ({ default: m.ClientPortalPage })));
const PortalLoginPage = lazy(() => import('./pages/PortalLoginPage').then(m => ({ default: m.PortalLoginPage })));
const PortalVerifyPage = lazy(() => import('./pages/PortalVerifyPage').then(m => ({ default: m.PortalVerifyPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const EmailDomainPage = lazy(() => import('./pages/EmailDomainPage').then(m => ({ default: m.EmailDomainPage })));
const TeamPage = lazy(() => import('./pages/TeamPage').then(m => ({ default: m.TeamPage })));
const StatusReportPage = lazy(() => import('./pages/StatusReportPage').then(m => ({ default: m.StatusReportPage })));
const SlaPortfolioPage = lazy(() => import('./pages/SlaPortfolioPage').then(m => ({ default: m.SlaPortfolioPage })));
const SlaTicketsPage = lazy(() => import('./pages/SlaTicketsPage').then(m => ({ default: m.SlaTicketsPage })));
const SalesPipelinePage = lazy(() => import('./pages/SalesPipelinePage').then(m => ({ default: m.SalesPipelinePage })));
const SalesDiscoveryLitePage = lazy(() => import('./pages/SalesDiscoveryLitePage').then(m => ({ default: m.SalesDiscoveryLitePage })));
const PortalDiscoveryLitePage = lazy(() => import('./pages/PortalDiscoveryLitePage').then(m => ({ default: m.PortalDiscoveryLitePage })));
const SalesProposalPage = lazy(() => import('./pages/SalesProposalPage').then(m => ({ default: m.SalesProposalPage })));
const SalesSowPage = lazy(() => import('./pages/SalesSowPage').then(m => ({ default: m.SalesSowPage })));
const SalesReportsPage = lazy(() => import('./pages/SalesReportsPage').then(m => ({ default: m.SalesReportsPage })));
const SalesTemplatesPage = lazy(() => import('./pages/SalesTemplatesPage').then(m => ({ default: m.SalesTemplatesPage })));
const VerticalWorkspacePage = lazy(() => import('./pages/VerticalWorkspacePage').then(m => ({ default: m.VerticalWorkspacePage })));
const CustomAdaptorsPage = lazy(() => import('./pages/CustomAdaptorsPage').then(m => ({ default: m.CustomAdaptorsPage })));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage').then(m => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage').then(m => ({ default: m.ResetPasswordPage })));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage').then(m => ({ default: m.VerifyEmailPage })));

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin h-8 w-8 border-2 border-brand-600 border-t-transparent rounded-full mx-auto" />
        <p className="text-sm text-gray-400 mt-3">Loading...</p>
      </div>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <PageLoader />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<ErrorBoundary><LoginPage /></ErrorBoundary>} />
        <Route path="/signup" element={<ErrorBoundary><SignupPage /></ErrorBoundary>} />
        <Route path="/forgot-password" element={<ErrorBoundary><ForgotPasswordPage /></ErrorBoundary>} />
        <Route path="/reset-password" element={<ErrorBoundary><ResetPasswordPage /></ErrorBoundary>} />
        <Route path="/verify-email" element={<ErrorBoundary><VerifyEmailPage /></ErrorBoundary>} />
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <ErrorBoundary><DashboardPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route
          path="/dashboard/archived"
          element={
            <RequireAuth>
              <ErrorBoundary><ArchivedDashboardPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireAuth>
              <ErrorBoundary><SettingsPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route
          path="/settings/email-domain"
          element={
            <RequireAuth>
              <ErrorBoundary><EmailDomainPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route
          path="/settings/team"
          element={
            <RequireAuth>
              <ErrorBoundary><TeamPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route
          path="/custom-adaptors"
          element={
            <RequireAuth>
              <ErrorBoundary><CustomAdaptorsPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route
          path="/engagements/:id/wizard"
          element={
            <RequireAuth>
              <ErrorBoundary><WizardPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route
          path="/engagements/:id/jobs/:jobId"
          element={
            <RequireAuth>
              <ErrorBoundary><JobBrowserPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        {/* Public client portal — no auth required for GET */}
        <Route path="/portal/:token" element={<ErrorBoundary><ClientPortalPage /></ErrorBoundary>} />
        {/* Portal sign-in — Phase 5A magic-link flow */}
        <Route path="/portal/:token/login" element={<ErrorBoundary><PortalLoginPage /></ErrorBoundary>} />
        <Route path="/portal/:token/verify" element={<ErrorBoundary><PortalVerifyPage /></ErrorBoundary>} />
        {/* Status report — print-optimized, auth required */}
        <Route
          path="/engagements/:id/status-report"
          element={
            <RequireAuth>
              <ErrorBoundary><StatusReportPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        {/* Phase 45.5 — SLA portfolio dashboard. Firm-wide cockpit
            for engagements currently under support. */}
        <Route
          path="/sla/dashboard"
          element={
            <RequireAuth>
              <ErrorBoundary><SlaPortfolioPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        {/* Phase 48.1 — SLA Engineer's ticket queue. Firm-wide list +
            two-pane detail with status / assignee / message thread. */}
        <Route
          path="/sla/tickets"
          element={
            <RequireAuth>
              <ErrorBoundary><SlaTicketsPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        {/* Phase 46.1 — Sales pipeline kanban. Restricted at the
            route layer to sales-role users; the page itself
            renders a permission-denied notice for everyone else. */}
        <Route
          path="/sales/pipeline"
          element={
            <RequireAuth>
              <ErrorBoundary><SalesPipelinePage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        {/* Phase 46.8.1 — Discovery Lite consultant wizard. */}
        <Route
          path="/sales/prospects/:id/discovery-lite"
          element={
            <RequireAuth>
              <ErrorBoundary><SalesDiscoveryLitePage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        {/* Phase 46.8.2 — Discovery Lite client self-serve. Token = auth,
            so this route is OUTSIDE RequireAuth on purpose. */}
        <Route
          path="/portal/discovery-lite/:token"
          element={<ErrorBoundary><PortalDiscoveryLitePage /></ErrorBoundary>}
        />
        {/* Phase 46.8.3 — Proposal management UI. */}
        <Route
          path="/sales/prospects/:id/proposal"
          element={
            <RequireAuth>
              <ErrorBoundary><SalesProposalPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        {/* Phase 46.8.4 — SOW management + signature center. */}
        <Route
          path="/sales/prospects/:id/sow"
          element={
            <RequireAuth>
              <ErrorBoundary><SalesSowPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        {/* Phase 46.8.5 — Sales reports dashboard. */}
        <Route
          path="/sales/reports"
          element={
            <RequireAuth>
              <ErrorBoundary><SalesReportsPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        {/* Phase 46.8.6 — Firm sales templates editor (APP_ADMIN only). */}
        <Route
          path="/settings/sales-templates"
          element={
            <RequireAuth>
              <ErrorBoundary><SalesTemplatesPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        {/* Vertical workspace */}
        <Route
          path="/engagements/:id/vertical"
          element={
            <RequireAuth>
              <ErrorBoundary><VerticalWorkspacePage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        {/* Data collection — rendered inside WizardPage via sidebar nav */}
        <Route
          path="/engagements/:id/data-collection"
          element={
            <RequireAuth>
              <ErrorBoundary><WizardPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        {/* Legacy redirect — preserve old bookmarks */}
        <Route path="/wizard/:id" element={<Navigate to="/dashboard" replace />} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
