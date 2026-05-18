/**
 * Phase 52.2 — /customers/:id stub.
 *
 * Reserves the route so the new top nav can land somewhere 200-OK
 * before Phase 52.4 ships the real detail page (header, progress
 * bar, action panel, stage-aware tabs, sidebar).
 */
import React from 'react';
import { useParams } from 'react-router-dom';
import { AppNav } from '../components/AppNav';
import { Users } from 'lucide-react';

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="min-h-screen bg-gray-50" data-testid="customer-detail-page">
      <AppNav />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="bg-white rounded-xl border border-gray-200 px-6 py-12 text-center">
          <Users className="h-10 w-10 text-gray-300 mx-auto mb-4" />
          <h1 className="text-lg font-semibold text-gray-900 mb-1">
            Customer detail
          </h1>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            Coming soon — Phase 52.4. Replaces the engagement wizard with a
            unified customer record (id <span className="font-mono">{id}</span>),
            phase progress bar, and stage-aware tabs.
          </p>
        </div>
      </main>
    </div>
  );
}
