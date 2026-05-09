import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, FileSignature, Loader2, RefreshCw, Sparkles, Eye, Download,
  ShieldCheck, Mail, Upload, CheckCircle2, AlertTriangle, Clock, X,
} from 'lucide-react';
import {
  engagementsApi,
  sowSignatureApi,
  type SowSignature,
  type SowSignatureStatus,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  PermissionDeniedState,
  extractPermissionDenied,
} from '@/components/rbac/PermissionDeniedState';

/**
 * Phase 46.8.4 — SOW management + signature center.
 *
 * Lives at /sales/prospects/:id/sow. Lets the sales rep:
 *
 *   1. Generate / regenerate the SOW PDF (creates an SOW
 *      GenerationJob; the existing pipeline writes the PDF to
 *      outputs/<jobId>/SOW/Statement_of_Work_v{N}.pdf)
 *   2. Preview the latest version inline (jobFileUrl points at the
 *      raw PDF; browsers render in-iframe)
 *   3. Send for signature via DocuSign (when configured) — modal
 *      collects signer name + email + title
 *   4. Send via manual path — drag-drop PDF upload + signer
 *      metadata; the route stamps SIGNED status on success and
 *      Phase 46.6's auto-conversion fires
 *   5. See all signature attempts with status pills (DRAFT/SENT/
 *      VIEWED/SIGNED/DECLINED/EXPIRED)
 *
 * After SIGNED status reached → page shows a confirmation banner
 * "Engagement converted to active. Project Manager notified.".
 */

interface Job {
  id: string;
  engagementId: string;
  type: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'FAILED';
  createdAt: string;
  completedAt: string | null;
}

const STATUS_STYLES: Record<SowSignatureStatus, { chip: string; label: string; Icon: typeof Clock }> = {
  DRAFT: { chip: 'bg-slate-100 text-slate-600', label: 'Draft', Icon: Clock },
  SENT: { chip: 'bg-sky-100 text-sky-700', label: 'Sent', Icon: Mail },
  VIEWED: { chip: 'bg-amber-100 text-amber-800', label: 'Viewed', Icon: Eye },
  SIGNED: { chip: 'bg-emerald-100 text-emerald-700', label: 'Signed', Icon: CheckCircle2 },
  DECLINED: { chip: 'bg-red-100 text-red-700', label: 'Declined', Icon: AlertTriangle },
  EXPIRED: { chip: 'bg-amber-100 text-amber-800', label: 'Expired', Icon: AlertTriangle },
};

export function SalesSowPage() {
  const { id } = useParams<{ id: string }>();
  const engagementId = id ?? '';
  const qc = useQueryClient();
  const [showDocuSignModal, setShowDocuSignModal] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);

  const jobsQuery = useQuery({
    queryKey: ['sow-jobs', engagementId],
    queryFn: async (): Promise<Job[]> => {
      const all = (await engagementsApi.listJobs(engagementId)) as Job[];
      return all.filter((j) => j.type === 'SOW').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    enabled: !!engagementId,
    refetchInterval: (q) => {
      const data = q.state.data as Job[] | undefined;
      return data?.some((j) => j.status === 'QUEUED' || j.status === 'RUNNING') ? 2000 : false;
    },
    retry: (count, err) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 403) return false;
      return count < 3;
    },
  });

  const sigsQuery = useQuery({
    queryKey: ['sow-signatures', engagementId],
    queryFn: () => sowSignatureApi.list(engagementId),
    enabled: !!engagementId,
    refetchInterval: (q) => {
      // Poll while any signature is in-flight (SENT/VIEWED) so the
      // UI catches the webhook update without a manual refresh.
      const data = q.state.data;
      return data?.signatures.some((s) => s.status === 'SENT' || s.status === 'VIEWED')
        ? 5000
        : false;
    },
    retry: (count, err) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 403) return false;
      return count < 3;
    },
  });

  const generateMutation = useMutation({
    mutationFn: () => engagementsApi.createJob(engagementId, 'SOW'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sow-jobs', engagementId] }),
  });

  const denied = extractPermissionDenied(jobsQuery.error);
  if (denied) {
    return (
      <PermissionDeniedState
        requiredRole={denied.requiredRole}
        verb="edit"
        resourceLabel="this engagement's SOW"
      />
    );
  }
  if (!engagementId) {
    return <p className="p-8 text-sm text-slate-500">Missing prospect id.</p>;
  }

  const jobs = jobsQuery.data ?? [];
  const latestJob = jobs[0];
  const signatures = sigsQuery.data?.signatures ?? [];
  const docusignConfigured = sigsQuery.data?.docusignConfigured ?? false;
  const latestSig = signatures[0];
  const isSigned = signatures.some((s) => s.status === 'SIGNED');
  // Inline the trivial derivation rather than useMemo it — Hooks
  // can't sit after the early returns above (rules-of-hooks). The
  // computation is O(1) so the memo gave no real benefit.
  const sowVersion = jobs.length;

  const previewUrl =
    latestJob && latestJob.status === 'COMPLETE'
      ? engagementsApi.jobFileUrl(
          engagementId,
          latestJob.id,
          `SOW/Statement_of_Work_v${sowVersion}.pdf`,
        )
      : null;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-5">
          <Link
            to="/sales/pipeline"
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-3"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to pipeline
          </Link>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <FileSignature className="h-5 w-5 text-emerald-600" />
                <h1 className="text-2xl font-bold text-slate-900">Statement of Work</h1>
                {sowVersion > 0 && (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                    v{sowVersion}
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-500">
                Generate the contract PDF, send for signature via DocuSign or upload a signed
                copy manually. SOW signed → engagement auto-converts to DISCOVERY.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending || jobsQuery.isLoading}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-40"
                data-testid="sow-generate"
              >
                {generateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : sowVersion > 0 ? (
                  <RefreshCw className="h-4 w-4" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {sowVersion > 0 ? 'Regenerate SOW' : 'Generate SOW'}
              </button>
            </div>
          </div>
        </div>

        {/* Auto-conversion banner */}
        {isSigned && (
          <div
            className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3"
            data-testid="sow-converted-banner"
          >
            <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-emerald-900">Engagement converted to active</p>
              <p className="text-xs text-emerald-700 mt-0.5">
                The Project Manager has been notified, the kickoff action item is created, and
                Discovery Lite answers carried forward into the full Discovery wizard.
              </p>
            </div>
          </div>
        )}

        {/* PDF preview + send-for-signature controls */}
        {latestJob && latestJob.status === 'COMPLETE' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            {/* Preview pane */}
            <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
                <p className="text-xs uppercase tracking-wider font-bold text-slate-500">
                  Preview — v{sowVersion}
                </p>
                {previewUrl && (
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-slate-500 hover:text-emerald-700 inline-flex items-center gap-1"
                  >
                    <Download className="h-3 w-3" />
                    Open in new tab
                  </a>
                )}
              </div>
              {previewUrl ? (
                <iframe
                  src={previewUrl}
                  title={`SOW v${sowVersion}`}
                  className="w-full h-[640px] bg-slate-50"
                  data-testid="sow-preview-iframe"
                />
              ) : (
                <div className="h-[640px] flex items-center justify-center text-slate-400 text-sm">
                  PDF unavailable
                </div>
              )}
            </div>

            {/* Send-for-signature controls */}
            <div className="space-y-3">
              <div className="bg-white rounded-2xl border border-slate-200 p-4">
                <p className="text-sm font-bold text-slate-900 mb-2">Send for signature</p>
                <p className="text-xs text-slate-500 mb-3">
                  Pick a path. Both fire the same auto-conversion when the SOW reaches SIGNED.
                </p>
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowDocuSignModal(true)}
                    disabled={!docusignConfigured || isSigned}
                    className={cn(
                      'w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-colors',
                      docusignConfigured && !isSigned
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                        : 'bg-slate-100 text-slate-400 cursor-not-allowed',
                    )}
                    title={
                      docusignConfigured
                        ? 'Send via DocuSign'
                        : 'DocuSign not configured for this firm'
                    }
                    data-testid="sow-send-docusign"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    Send via DocuSign
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowManualModal(true)}
                    disabled={isSigned}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    data-testid="sow-upload-manual"
                  >
                    <Upload className="h-4 w-4" />
                    Upload signed PDF
                  </button>
                </div>
                {!docusignConfigured && (
                  <p className="text-[11px] text-slate-400 mt-3">
                    Configure DocuSign in <Link to="/settings" className="underline">Settings</Link>{' '}
                    to enable the e-sign path. Manual upload always works as fallback.
                  </p>
                )}
              </div>

              {/* Latest signature */}
              {latestSig && (
                <div className="bg-white rounded-2xl border border-slate-200 p-4">
                  <p className="text-sm font-bold text-slate-900 mb-2">Latest signature</p>
                  <SignatureRow signature={latestSig} engagementId={engagementId} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty state when no SOW generated */}
        {jobs.length === 0 && !jobsQuery.isLoading && (
          <EmptyState onGenerate={() => generateMutation.mutate()} pending={generateMutation.isPending} />
        )}

        {/* All signature attempts list */}
        {signatures.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-sm font-bold text-slate-900">All signature attempts</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {signatures.length} attempt{signatures.length === 1 ? '' : 's'} on file.
              </p>
            </div>
            <ul className="divide-y divide-slate-100" data-testid="sow-signature-list">
              {signatures.map((s) => (
                <li key={s.id} className="px-4 py-3">
                  <SignatureRow signature={s} engagementId={engagementId} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {showDocuSignModal && latestJob && (
        <DocuSignModal
          engagementId={engagementId}
          version={sowVersion}
          onClose={() => setShowDocuSignModal(false)}
          onSent={() => {
            setShowDocuSignModal(false);
            qc.invalidateQueries({ queryKey: ['sow-signatures', engagementId] });
          }}
        />
      )}
      {showManualModal && latestJob && (
        <ManualUploadModal
          engagementId={engagementId}
          version={sowVersion}
          onClose={() => setShowManualModal(false)}
          onUploaded={() => {
            setShowManualModal(false);
            qc.invalidateQueries({ queryKey: ['sow-signatures', engagementId] });
            qc.invalidateQueries({ queryKey: ['sow-jobs', engagementId] });
          }}
        />
      )}
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

function SignatureRow({
  signature,
  engagementId,
}: {
  signature: SowSignature;
  engagementId: string;
}) {
  const styles = STATUS_STYLES[signature.status];
  return (
    <div className="flex items-start justify-between gap-3" data-testid={`sow-signature-${signature.id}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span
            className={cn(
              'inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full',
              styles.chip,
            )}
          >
            <styles.Icon className="h-3 w-3" />
            {styles.label}
          </span>
          <span className="text-[11px] text-slate-500 font-mono">{signature.signaturePath}</span>
        </div>
        <p className="text-sm text-slate-700">
          {signature.signedByName ?? '—'}
          {signature.signedByEmail && (
            <span className="text-xs text-slate-500"> · {signature.signedByEmail}</span>
          )}
          {signature.signedByTitle && (
            <span className="text-xs text-slate-500"> · {signature.signedByTitle}</span>
          )}
        </p>
        <p className="text-[11px] text-slate-400 mt-0.5">
          Created{' '}
          {new Date(signature.createdAt).toLocaleString('en-GB', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
          {signature.signedAt && (
            <>
              {' · signed '}
              {new Date(signature.signedAt).toLocaleString('en-GB', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </>
          )}
        </p>
      </div>
      {signature.signedFileUrl && (
        <a
          href={
            signature.signedFileUrl.startsWith('/uploads/')
              ? `${(typeof window !== 'undefined' ? window.location.origin : '')}${signature.signedFileUrl}`
              : signature.signedFileUrl
          }
          target="_blank"
          rel="noreferrer"
          className="text-xs text-emerald-700 hover:text-emerald-900 inline-flex items-center gap-1 flex-shrink-0"
          data-testid={`sow-signed-file-${signature.id}`}
        >
          <Download className="h-3.5 w-3.5" />
          Signed PDF
        </a>
      )}
      {/* Engagement context — for the all-attempts list a per-row link
          back to the engagement helps when audit-walking. */}
      <span className="hidden">{engagementId}</span>
    </div>
  );
}

function EmptyState({ onGenerate, pending }: { onGenerate: () => void; pending: boolean }) {
  return (
    <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-12 text-center">
      <div className="mx-auto w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
        <FileSignature className="h-7 w-7 text-emerald-600" />
      </div>
      <p className="text-base font-semibold text-slate-700 mb-2">No SOW generated yet</p>
      <p className="text-sm text-slate-500 max-w-md mx-auto mb-4">
        Generate the SOW once the proposal is accepted. Pricing pulls from Discovery Lite +
        firm defaults and stays consistent with the latest Proposal version.
      </p>
      <button
        type="button"
        onClick={onGenerate}
        disabled={pending}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-40"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        Generate SOW
      </button>
    </div>
  );
}

interface DocuSignModalProps {
  engagementId: string;
  version: number;
  onClose: () => void;
  onSent: () => void;
}

function DocuSignModal({ engagementId, version, onClose, onSent }: DocuSignModalProps) {
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [signerTitle, setSignerTitle] = useState('');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () =>
      sowSignatureApi.sendDocuSign(engagementId, {
        signerName: signerName.trim(),
        signerEmail: signerEmail.trim(),
        signerTitle: signerTitle.trim() || undefined,
      }),
    onSuccess: () => {
      setErrMsg(null);
      onSent();
    },
    onError: (err: unknown) => {
      const e = (err as { response?: { data?: { error?: { code?: string; message?: string } } } })
        ?.response?.data?.error;
      setErrMsg(e?.message ?? 'Could not send envelope. Try again.');
    },
  });
  const canSubmit =
    signerName.trim().length > 0 && /.+@.+\..+/.test(signerEmail.trim()) && !mutation.isPending;
  return (
    <Modal title={`Send SOW v${version} via DocuSign`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Signer name *">
          <input
            type="text"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            placeholder="Jane Tate"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            autoFocus
          />
        </Field>
        <Field label="Signer email *">
          <input
            type="email"
            value={signerEmail}
            onChange={(e) => setSignerEmail(e.target.value)}
            placeholder="jane@acme.example"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          />
        </Field>
        <Field label="Signer title">
          <input
            type="text"
            value={signerTitle}
            onChange={(e) => setSignerTitle(e.target.value)}
            placeholder="Chief Financial Officer"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          />
        </Field>
        {errMsg && (
          <p className="text-xs text-red-600 inline-flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {errMsg}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button
          type="button"
          onClick={onClose}
          disabled={mutation.isPending}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={!canSubmit}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
          data-testid="sow-docusign-submit"
        >
          {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Send envelope
        </button>
      </div>
    </Modal>
  );
}

interface ManualUploadModalProps {
  engagementId: string;
  version: number;
  onClose: () => void;
  onUploaded: () => void;
}

function ManualUploadModal({ engagementId, version, onClose, onUploaded }: ManualUploadModalProps) {
  const [signedByName, setSignedByName] = useState('');
  const [signedByEmail, setSignedByEmail] = useState('');
  const [signedByTitle, setSignedByTitle] = useState('');
  const [signedDate, setSignedDate] = useState('');
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [readingFile, setReadingFile] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      sowSignatureApi.uploadManual(engagementId, {
        fileBase64: fileBase64 ?? '',
        signedByName: signedByName.trim(),
        signedByEmail: signedByEmail.trim() || undefined,
        signedByTitle: signedByTitle.trim() || undefined,
        signedDate: signedDate || undefined,
      }),
    onSuccess: () => {
      setErrMsg(null);
      onUploaded();
    },
    onError: (err: unknown) => {
      const e = (err as { response?: { data?: { error?: { code?: string; message?: string } } } })
        ?.response?.data?.error;
      setErrMsg(e?.message ?? 'Upload failed. Make sure the file is a PDF under 10MB.');
    },
  });

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErrMsg(null);
    if (f.type !== 'application/pdf' && !f.name.endsWith('.pdf')) {
      setErrMsg('File must be a PDF.');
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setErrMsg('File is too large (10MB max).');
      return;
    }
    setReadingFile(true);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result is `data:application/pdf;base64,XXXX` — strip the prefix.
      const idx = result.indexOf('base64,');
      const b64 = idx >= 0 ? result.slice(idx + 'base64,'.length) : result;
      setFileBase64(b64);
      setFilename(f.name);
      setReadingFile(false);
    };
    reader.onerror = () => {
      setErrMsg("Couldn't read the file.");
      setReadingFile(false);
    };
    reader.readAsDataURL(f);
  }

  const canSubmit =
    !!fileBase64 && signedByName.trim().length > 0 && !mutation.isPending && !readingFile;

  return (
    <Modal title={`Upload signed SOW v${version}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Signed PDF *">
          <label
            className="block w-full rounded-xl border-2 border-dashed border-slate-200 px-4 py-6 text-center cursor-pointer hover:border-emerald-300 hover:bg-emerald-50/30 transition-colors"
            data-testid="sow-manual-file-input"
          >
            <Upload className="h-5 w-5 text-slate-400 mx-auto mb-1.5" />
            <span className="block text-sm font-semibold text-slate-700">
              {filename ? filename : 'Click to select a PDF (10MB max)'}
            </span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={handleFile}
              className="hidden"
            />
          </label>
        </Field>
        <Field label="Signed by (name) *">
          <input
            type="text"
            value={signedByName}
            onChange={(e) => setSignedByName(e.target.value)}
            placeholder="Jane Tate"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Email">
            <input
              type="email"
              value={signedByEmail}
              onChange={(e) => setSignedByEmail(e.target.value)}
              placeholder="jane@acme.example"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            />
          </Field>
          <Field label="Title">
            <input
              type="text"
              value={signedByTitle}
              onChange={(e) => setSignedByTitle(e.target.value)}
              placeholder="CFO"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            />
          </Field>
        </div>
        <Field label="Signed date">
          <input
            type="date"
            value={signedDate}
            onChange={(e) => setSignedDate(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          />
        </Field>
        {errMsg && (
          <p className="text-xs text-red-600 inline-flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {errMsg}
          </p>
        )}
        {fileBase64 && (
          <p className="text-xs text-emerald-600 inline-flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            File ready ({Math.round(fileBase64.length * 0.75 / 1024)} KB).
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button
          type="button"
          onClick={onClose}
          disabled={mutation.isPending}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={!canSubmit}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
          data-testid="sow-manual-submit"
        >
          {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Mark as signed
        </button>
      </div>
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

// Pure helper exported for tests — turns a File-style base64 string
// into a rough byte-size estimate (3:4 expansion). Used by the
// "File ready" indicator above.
export function approxBase64Bytes(b64: string): number {
  return Math.round(b64.length * 0.75);
}
