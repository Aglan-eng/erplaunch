import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';

// Lazy-loaded pages — each becomes its own JS chunk
const LoginPage = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const WizardPage = lazy(() => import('./pages/WizardPage').then(m => ({ default: m.WizardPage })));
const ClientPortalPage = lazy(() => import('./pages/ClientPortalPage').then(m => ({ default: m.ClientPortalPage })));
const StatusReportPage = lazy(() => import('./pages/StatusReportPage').then(m => ({ default: m.StatusReportPage })));
const VerticalWorkspacePage = lazy(() => import('./pages/VerticalWorkspacePage').then(m => ({ default: m.VerticalWorkspacePage })));

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
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <ErrorBoundary><DashboardPage /></ErrorBoundary>
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
        {/* Public client portal — no auth required */}
        <Route path="/portal/:token" element={<ErrorBoundary><ClientPortalPage /></ErrorBoundary>} />
        {/* Status report — print-optimized, auth required */}
        <Route
          path="/engagements/:id/status-report"
          element={
            <RequireAuth>
              <ErrorBoundary><StatusReportPage /></ErrorBoundary>
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
