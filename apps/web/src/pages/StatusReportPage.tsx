import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { engagementsApi } from '@/lib/api';

const STATUS_LABELS: Record<string, string> = {
  DISCOVERY: 'Discovery', SCOPING: 'Scoping', BUILD: 'Build', UAT: 'UAT', GO_LIVE: 'Go-Live',
};
const STAGE_ORDER = ['DISCOVERY', 'SCOPING', 'BUILD', 'UAT', 'GO_LIVE'];
const RISK_COLORS: Record<string, string> = {
  CRITICAL: '#dc2626', HIGH: '#ea580c', MEDIUM: '#d97706', LOW: '#6b7280',
};
const ISSUE_COLORS: Record<string, string> = {
  CRITICAL: '#dc2626', HIGH: '#ea580c', MEDIUM: '#d97706', LOW: '#6b7280',
};

function fmt(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function StatusReportPage() {
  const { id: engagementId } = useParams<{ id: string }>();

  const { data: engagement, isLoading: engLoading } = useQuery({
    queryKey: ['engagement', engagementId],
    queryFn: () => engagementsApi.get(engagementId!),
    enabled: !!engagementId,
  });

  const { data: members = [] } = useQuery({
    queryKey: ['members', engagementId],
    queryFn: () => engagementsApi.getMembers(engagementId!),
    enabled: !!engagementId,
  });

  const { data: risks = [] } = useQuery({
    queryKey: ['risks', engagementId],
    queryFn: () => engagementsApi.listRisks(engagementId!),
    enabled: !!engagementId,
  });

  const { data: issues = [] } = useQuery({
    queryKey: ['issues', engagementId],
    queryFn: () => engagementsApi.listIssues(engagementId!),
    enabled: !!engagementId,
  });

  const { data: decisions = [] } = useQuery({
    queryKey: ['decisions', engagementId],
    queryFn: () => engagementsApi.listDecisions(engagementId!),
    enabled: !!engagementId,
  });

  const allLoaded = !engLoading && engagement;

  // Auto-trigger print dialog once data loads
  useEffect(() => {
    if (allLoaded) {
      setTimeout(() => window.print(), 500);
    }
  }, [allLoaded]);

  if (!allLoaded) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif' }}>
        <p style={{ color: '#6b7280' }}>Preparing status report…</p>
      </div>
    );
  }

  const stageIdx = STAGE_ORDER.indexOf(engagement.status ?? 'DISCOVERY');
  const clientMembers = (members as Array<any>).filter((m: any) => m.team !== 'CONSULTANT');
  const ofoqMembers = (members as Array<any>).filter((m: any) => m.team === 'CONSULTANT');
  const openRisks = (risks as Array<any>).filter((r: any) => r.status === 'OPEN');
  const openIssues = (issues as Array<any>).filter((i: any) => ['OPEN', 'IN_PROGRESS'].includes(i.status));
  const recentDecisions = (decisions as Array<any>).slice(0, 5);

  const daysLeft = engagement.contractEndDate
    ? Math.ceil((new Date(engagement.contractEndDate).getTime() - Date.now()) / 86_400_000)
    : null;

  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div style={{ fontFamily: "'Segoe UI', system-ui, sans-serif", margin: 0, padding: 0, background: '#fff', color: '#111' }}>
      <style>{`
        @page { margin: 18mm 15mm; size: A4; }
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          .page-break { page-break-before: always; }
        }
        * { box-sizing: border-box; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #e5e7eb; padding: 7px 10px; text-align: left; font-size: 11px; }
        th { background: #f9fafb; font-weight: 700; color: #374151; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; }
      `}</style>

      {/* ── No-print toolbar ── */}
      <div className="no-print" style={{ background: '#1e1b4b', color: '#fff', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Status Report Preview</span>
        <button onClick={() => window.print()} style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          Print / Save as PDF
        </button>
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '32px 24px' }}>

        {/* ── Header ── */}
        <div style={{ borderBottom: '3px solid #7c3aed', paddingBottom: 20, marginBottom: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
                NetSuite Implementation
              </div>
              <h1 style={{ fontSize: 28, fontWeight: 900, margin: 0, color: '#111827' }}>{engagement.clientName}</h1>
              <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>Status Report · {today}</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#7c3aed' }}>{STATUS_LABELS[engagement.status] ?? engagement.status}</div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Current Stage</div>
            </div>
          </div>
        </div>

        {/* ── Stage Progress ── */}
        <div style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 14, fontWeight: 800, color: '#111827', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Stage Progress</h2>
          <div style={{ display: 'flex', gap: 0, borderRadius: 8, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
            {STAGE_ORDER.map((s, i) => {
              const done = stageIdx >= i;
              const active = engagement.status === s;
              return (
                <div key={s} style={{
                  flex: 1, padding: '10px 8px', textAlign: 'center',
                  background: active ? '#7c3aed' : done ? '#ede9fe' : '#f9fafb',
                  borderRight: i < STAGE_ORDER.length - 1 ? '1px solid #e5e7eb' : 'none',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: active ? '#fff' : done ? '#6d28d9' : '#9ca3af' }}>
                    {STATUS_LABELS[s]}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Project Summary ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 28 }}>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '16px 20px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Project Timeline</div>
            <table style={{ border: 'none' }}>
              <tbody>
                <tr>
                  <td style={{ border: 'none', padding: '3px 0', fontSize: 12, color: '#6b7280', width: '50%' }}>Start Date</td>
                  <td style={{ border: 'none', padding: '3px 0', fontSize: 12, fontWeight: 700, color: '#111827' }}>{fmt(engagement.startDate)}</td>
                </tr>
                <tr>
                  <td style={{ border: 'none', padding: '3px 0', fontSize: 12, color: '#6b7280' }}>Contract End</td>
                  <td style={{ border: 'none', padding: '3px 0', fontSize: 12, fontWeight: 700, color: '#111827' }}>{fmt(engagement.contractEndDate)}</td>
                </tr>
                {daysLeft !== null && (
                  <tr>
                    <td style={{ border: 'none', padding: '3px 0', fontSize: 12, color: '#6b7280' }}>Days Left</td>
                    <td style={{ border: 'none', padding: '3px 0', fontSize: 12, fontWeight: 700, color: daysLeft < 0 ? '#dc2626' : daysLeft <= 14 ? '#d97706' : '#16a34a' }}>
                      {daysLeft < 0 ? `${Math.abs(daysLeft)} days overdue` : `${daysLeft} days`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '16px 20px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Health Summary</div>
            <table style={{ border: 'none' }}>
              <tbody>
                <tr>
                  <td style={{ border: 'none', padding: '3px 0', fontSize: 12, color: '#6b7280', width: '60%' }}>Open Risks</td>
                  <td style={{ border: 'none', padding: '3px 0', fontSize: 12, fontWeight: 700, color: openRisks.length > 0 ? '#dc2626' : '#16a34a' }}>{openRisks.length}</td>
                </tr>
                <tr>
                  <td style={{ border: 'none', padding: '3px 0', fontSize: 12, color: '#6b7280' }}>Open Issues</td>
                  <td style={{ border: 'none', padding: '3px 0', fontSize: 12, fontWeight: 700, color: openIssues.length > 0 ? '#ea580c' : '#16a34a' }}>{openIssues.length}</td>
                </tr>
                <tr>
                  <td style={{ border: 'none', padding: '3px 0', fontSize: 12, color: '#6b7280' }}>Committee</td>
                  <td style={{ border: 'none', padding: '3px 0', fontSize: 12, fontWeight: 700, color: '#111827' }}>{(members as Array<any>).length} members</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Committee ── */}
        {(members as Array<any>).length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 14, fontWeight: 800, color: '#111827', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Project Committee</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {clientMembers.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Client Team</div>
                  <table>
                    <thead><tr><th>Name</th><th>Role</th></tr></thead>
                    <tbody>
                      {clientMembers.map((m: any) => (
                        <tr key={m.id}><td>{m.name}</td><td style={{ color: '#6b7280' }}>{m.role}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {ofoqMembers.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Implementation Team</div>
                  <table>
                    <thead><tr><th>Name</th><th>Role</th></tr></thead>
                    <tbody>
                      {ofoqMembers.map((m: any) => (
                        <tr key={m.id}><td>{m.name}</td><td style={{ color: '#6b7280' }}>{m.role}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Risks ── */}
        {openRisks.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 14, fontWeight: 800, color: '#111827', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Open Risks ({openRisks.length})</h2>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 80 }}>Score</th>
                  <th>Title</th>
                  <th>Mitigation</th>
                </tr>
              </thead>
              <tbody>
                {openRisks.map((r: any) => (
                  <tr key={r.id}>
                    <td>
                      <span className="badge" style={{ background: `${RISK_COLORS[r.riskScore] ?? '#6b7280'}20`, color: RISK_COLORS[r.riskScore] ?? '#6b7280' }}>
                        {r.riskScore ?? '—'}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600 }}>{r.title}</td>
                    <td style={{ color: '#6b7280' }}>{r.mitigation || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Issues ── */}
        {openIssues.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 14, fontWeight: 800, color: '#111827', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Open Issues ({openIssues.length})</h2>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 80 }}>Priority</th>
                  <th>Title</th>
                  <th>Assigned To</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {openIssues.map((i: any) => (
                  <tr key={i.id}>
                    <td>
                      <span className="badge" style={{ background: `${ISSUE_COLORS[i.priority] ?? '#6b7280'}20`, color: ISSUE_COLORS[i.priority] ?? '#6b7280' }}>
                        {i.priority}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600 }}>{i.title}</td>
                    <td style={{ color: '#6b7280' }}>{i.assignedTo || '—'}</td>
                    <td style={{ color: '#6b7280' }}>{i.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Recent Decisions ── */}
        {recentDecisions.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 14, fontWeight: 800, color: '#111827', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recent Decisions</h2>
            <table>
              <thead>
                <tr>
                  <th>Decision</th>
                  <th>Decided By</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {recentDecisions.map((d: any) => (
                  <tr key={d.id}>
                    <td style={{ fontWeight: 600 }}>{d.title}</td>
                    <td style={{ color: '#6b7280' }}>{d.decidedBy || '—'}</td>
                    <td style={{ color: '#6b7280' }}>{d.decidedAt ? fmt(d.decidedAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Footer ── */}
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 14, marginTop: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ fontSize: 10, color: '#9ca3af', margin: 0 }}>Generated by ERPLaunch · {today}</p>
          <p style={{ fontSize: 10, color: '#9ca3af', margin: 0 }}>Confidential</p>
        </div>

      </div>
    </div>
  );
}
