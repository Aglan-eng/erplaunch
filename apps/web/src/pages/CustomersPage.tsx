/**
 * Phase 52.2 — /customers stub.
 *
 * Reserves the route so the new top nav can land somewhere 200-OK
 * before Phase 52.3 ships the real kanban/list view of the unified
 * Customer table.
 */
import React from 'react';
import { AppNav } from '../components/AppNav';
import { Users } from 'lucide-react';

export function CustomersPage() {
  return (
    <div className="min-h-screen bg-gray-50" data-testid="customers-page">
      <AppNav />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="bg-white rounded-xl border border-gray-200 px-6 py-12 text-center">
          <Users className="h-10 w-10 text-gray-300 mx-auto mb-4" />
          <h1 className="text-lg font-semibold text-gray-900 mb-1">Customers</h1>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            Coming soon — Phase 52.3. Every customer from Lead to Renewed in
            one unified list, with kanban + list views and stage-aware filters.
          </p>
        </div>
      </main>
    </div>
  );
}
