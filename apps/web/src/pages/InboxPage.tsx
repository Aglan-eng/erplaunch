/**
 * Phase 52.2 — /inbox stub.
 *
 * Reserves the route so the new top nav can land somewhere 200-OK
 * before Phase 52.5 ships the real role-aware home. The real
 * implementation will replace the placeholder body but keep the
 * `<AppNav />` wrapper.
 */
import React from 'react';
import { AppNav } from '../components/AppNav';
import { Inbox } from 'lucide-react';

export function InboxPage() {
  return (
    <div className="min-h-screen bg-gray-50" data-testid="inbox-page">
      <AppNav />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="bg-white rounded-xl border border-gray-200 px-6 py-12 text-center">
          <Inbox className="h-10 w-10 text-gray-300 mx-auto mb-4" />
          <h1 className="text-lg font-semibold text-gray-900 mb-1">Inbox</h1>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            Coming soon — Phase 52.5. The Inbox will surface role-appropriate
            work items (follow-ups, decisions, renewals, invoices) tuned to
            your role.
          </p>
        </div>
      </main>
    </div>
  );
}
