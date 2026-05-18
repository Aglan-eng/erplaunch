/**
 * Phase 52.2 — /reports stub.
 *
 * Reserves the route so the new top nav has somewhere 200-OK to
 * land. Real Reports surface ships in Phase 53.
 */
import React from 'react';
import { AppNav } from '../components/AppNav';
import { BarChart3 } from 'lucide-react';

export function ReportsPage() {
  return (
    <div className="min-h-screen bg-gray-50" data-testid="reports-page">
      <AppNav />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="bg-white rounded-xl border border-gray-200 px-6 py-12 text-center">
          <BarChart3 className="h-10 w-10 text-gray-300 mx-auto mb-4" />
          <h1 className="text-lg font-semibold text-gray-900 mb-1">Reports</h1>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            Coming soon — Phase 53. Cross-customer reporting (pipeline value,
            win rates, renewal forecast, portfolio health) lives here.
          </p>
        </div>
      </main>
    </div>
  );
}
