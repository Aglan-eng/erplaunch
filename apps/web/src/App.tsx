import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AssistantProvider } from './components/assistant/AssistantPanel';

// Lazy-loaded pages — each becomes its own JS chunk
const LoginPage = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const SignupPage = lazy(() => import('./pages/SignupPage').then(m => ({ default: m.SignupPage })));
const JobBrowserPage = lazy(() => import('./pages/JobBrowserPage').then(m => ({ default: m.JobBrowserPage })));
const WizardPage = lazy(() => import('./pages/WizardPage').then(m => ({ default: m.WizardPage })));
const ClientPortalPage = lazy(() => import('./pages/ClientPortalPage').then(m => ({ default: m.ClientPortalPage })));
const PortalLoginPage = lazy(() => import('./pages/PortalLoginPage').then(m => ({ default: m.PortalLoginPage })));
const PortalVerifyPage = lazy(() => import('./pages/PortalVerifyPage').then(m => ({ default: m.PortalVerifyPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const EmailDomainPage = lazy(() => import('./pages/EmailDomainPage').then(m => ({ default: m.EmailDomainPage })));
const TeamPage = lazy(() => import('./pages/TeamPage').then(m => ({ default: m.TeamPage })));
const StatusReportPage = lazy(() => import('./pages/StatusReportPage').then(m => ({ default: m.StatusReportPage })));
const SalesDiscoveryLitePage = lazy(() => import('./pages/SalesDiscoveryLitePage').then(m => ({ default: m.SalesDiscoveryLitePage })));
const PortalDiscoveryLitePage = lazy(() => import('./pages/PortalDiscoveryLitePage').then(m => ({ default: m.PortalDiscoveryLitePage })));
const SalesProposalPage = lazy(() => import('./pages/SalesProposalPage').then(m => ({ default: m.SalesProposalPage })));
const SalesSowPage = lazy(() => import('./pages/SalesSowPage').then(m => ({ default: m.SalesSowPage })));
const SalesTemplatesPage = lazy(() => import('./pages/SalesTemplatesPage').then(m => ({ default: m.SalesTemplatesPage })));
const SettingsTemplatesPage = lazy(() => import('./pages/SettingsTemplatesPage').then(m => ({ default: m.SettingsTemplatesPage })));
const EngagementDocumentsPage = lazy(() => import('./pages/EngagementDocumentsPage').then(m => ({ default: m.EngagementDocumentsPage })));
const VerticalWorkspacePage = lazy(() => import('./pages/VerticalWorkspacePage').then(m => ({ default: m.VerticalWorkspacePage })));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage').then(m => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage').then(m => ({ default: m.ResetPasswordPage })));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage').then(m => ({ default: m.VerifyEmailPage })));
// Phase 52 — unified-IA pages.
const InboxPage = lazy(() => import('./pages/InboxPage').then(m => ({ default: m.InboxPage })));
const CustomersPage = lazy(() => import('./pages/CustomersPage').then(m => ({ default: m.CustomersPage })));
const CustomerDetailPage = lazy(() => import('./pages/CustomerDetailPage').then(m => ({ default: m.CustomerDetailPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then(m => ({ default: m.ReportsPage })));
const HelpPage = lazy(() => import('./pages/HelpPage').then(m => ({ default: m.HelpPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage').then((m) => ({ default: m.ProjectsPage })));

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

/**
 * Phase 53.3 — Role-aware home redirect. CEO lands on the
 * executive dashboard; everyone else (including APP_ADMIN) on the
 * Inbox. Unauthenticated users are pushed to /login via RequireAuth
 * after first being routed through here.
 */
function RoleAwareHome() {
  const { user, loading } = useAuth();
  if (loading) {
    return <PageLoader />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  // Phase 55.1 — everyone lands on /dashboard. Role-aware data
  // scope happens inside the dashboard component, not via routing.
  return <Navigate to="/dashboard" replace />;
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

        {/* ── Phase 52 unified-IA primary surfaces ───────────────────── */}
        <Route
          path="/inbox"
          element={
            <RequireAuth>
              <ErrorBoundary><InboxPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route
          path="/customers"
          element={
            <RequireAuth>
              <ErrorBoundary><CustomersPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route
          path="/customers/:id"
          element={
            <RequireAuth>
              <ErrorBoundary><CustomerDetailPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route
          path="/reports"
          element={
            <RequireAuth>
              <ErrorBoundary><ReportsPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route
          path="/help"
          element={
            <RequireAuth>
              <ErrorBoundary><HelpPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <ErrorBoundary><DashboardPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route
          path="/projects"
          element={
            <RequireAuth>
              <ErrorBoundary><ProjectsPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        {/* Phase 55.1 — /executive is folded into /dashboard. */}
        <Route path="/executive" element={<Navigate to="/dashboard" replace />} />

        {/* ── Settings (tabbed in Phase 52.8: firm/brand-pack/adaptors/tickets/email) ─ */}
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
          path="/settings/sales-templates"
          element={
            <RequireAuth>
              <ErrorBoundary><SalesTemplatesPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route
          path="/settings/templates"
          element={
            <RequireAuth>
              <ErrorBoundary><SettingsTemplatesPage /></ErrorBoundary>
            </RequireAuth>
          }
        />

        {/* ── Per-customer drill-downs (still routed by id) ──────────── */}
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
        <Route
          path="/engagements/:id/status-report"
          element={
            <RequireAuth>
              <ErrorBoundary><StatusReportPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route
          path="/engagements/:id/documents"
          element={
            <RequireAuth>
              <ErrorBoundary><EngagementDocumentsPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route
          path="/engagements/:id/vertical"
          element={
            <RequireAuth>
              <ErrorBoundary><VerticalWorkspacePage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route
          path="/engagements/:id/data-collection"
          element={
            <RequireAuth>
              <ErrorBoundary><WizardPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route
          path="/sales/prospects/:id/discovery-lite"
          element={
            <RequireAuth>
              <ErrorBoundary><SalesDiscoveryLitePage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route
          path="/sales/prospects/:id/proposal"
          element={
            <RequireAuth>
              <ErrorBoundary><SalesProposalPage /></ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route
          path="/sales/prospects/:id/sow"
          element={
            <RequireAuth>
              <ErrorBoundary><SalesSowPage /></ErrorBoundary>
            </RequireAuth>
          }
        />

        {/* ── Public portal routes ───────────────────────────────────── */}
        <Route path="/portal/:token" element={<ErrorBoundary><ClientPortalPage /></ErrorBoundary>} />
        <Route path="/portal/:token/login" element={<ErrorBoundary><PortalLoginPage /></ErrorBoundary>} />
        <Route path="/portal/:token/verify" element={<ErrorBoundary><PortalVerifyPage /></ErrorBoundary>} />
        <Route
          path="/portal/discovery-lite/:token"
          element={<ErrorBoundary><PortalDiscoveryLitePage /></ErrorBoundary>}
        />

        {/* ── Phase 52.8 cutover: legacy URL redirects ───────────────── */}
        <Route path="/dashboard" element={<Navigate to="/inbox" replace />} />
        <Route path="/dashboard/archived" element={<Navigate to="/customers?archived=true" replace />} />
        <Route path="/archived" element={<Navigate to="/customers?archived=true" replace />} />
        <Route path="/sales" element={<Navigate to="/reports?tab=pipeline" replace />} />
        <Route path="/sales/pipeline" element={<Navigate to="/reports?tab=pipeline" replace />} />
        <Route path="/sales/reports" element={<Navigate to="/reports?tab=pipeline" replace />} />
        <Route path="/sla" element={<Navigate to="/reports?tab=health" replace />} />
        <Route path="/sla/dashboard" element={<Navigate to="/reports?tab=health" replace />} />
        <Route path="/tickets" element={<Navigate to="/settings?tab=tickets" replace />} />
        <Route path="/sla/tickets" element={<Navigate to="/settings?tab=tickets" replace />} />
        <Route path="/adaptors" element={<Navigate to="/settings?tab=adaptors" replace />} />
        <Route path="/custom-adaptors" element={<Navigate to="/settings?tab=adaptors" replace />} />
        <Route path="/wizard/:id" element={<Navigate to="/inbox" replace />} />

        {/* Home + catch-all. Phase 53.3 — CEO lands on /executive. */}
        <Route path="/" element={<RoleAwareHome />} />
        <Route path="*" element={<RoleAwareHome />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          {/* Phase 55.2 hotfix — single AssistantProvider at the app
              root so navigating between pages doesn't unmount/remount
              the provider tree on every transition. */}
          <AssistantProvider>
            <AppRoutes />
          </AssistantProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
