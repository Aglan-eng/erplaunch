import React, { useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { engagementsApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  Sparkles, Download, Upload, CheckCircle2, Clock, TriangleAlert,
  ChevronDown, ChevronRight, X, FileSpreadsheet, Plus, Loader2, RefreshCw,
  CircleCheck, ArrowUpRight, Trash2, MessageSquare,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CollectionItem {
  id: string;
  templateId: string;
  name: string;
  category: string;
  status: string;
  assignedTo?: string;
  dueDate?: string;
  notes?: string;
  fields?: Array<{ key: string; label: string; required: boolean }>;
  validationRules?: string[];
}

interface DataFile {
  id: string;
  originalName: string;
  sizeBytes: number;
  uploadedBy?: string;
  validationStatus: string;
  rowCount?: number;
  errorCount?: number;
  warningCount?: number;
  validationResult?: {
    valid: boolean;
    summary: string;
    issues?: Array<{ row?: number; column?: string; severity: 'ERROR' | 'WARNING'; message: string }>;
  };
  createdAt: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  NOT_STARTED: { label: 'Not started',   color: 'bg-gray-100 text-gray-500',    icon: Clock },
  SENT:        { label: 'Sent to client', color: 'bg-blue-100 text-blue-700',    icon: ArrowUpRight },
  RECEIVED:    { label: 'Received',       color: 'bg-violet-100 text-violet-700', icon: CheckCircle2 },
  VALIDATED:   { label: 'Validated',      color: 'bg-amber-100 text-amber-700',  icon: CircleCheck },
  UPLOADED:    { label: 'Uploaded to NS', color: 'bg-green-100 text-green-700',  icon: CircleCheck },
};

const CATEGORY_LABELS: Record<string, string> = {
  financial: 'Financial Data',
  master: 'Master Data',
  transactional: 'Transactional Data',
  vertical: 'Vertical-Specific Data',
};

const CATEGORY_ORDER = ['financial', 'master', 'transactional', 'vertical'];

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: 'bg-gray-100 text-gray-500', icon: Clock };
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full', cfg.color)}>
      <Icon className="h-2.5 w-2.5" />
      {cfg.label}
    </span>
  );
}

// ─── Validation result panel ──────────────────────────────────────────────────

function ValidationPanel({ file }: { file: DataFile }) {
  const result = file.validationResult;
  if (!result) return null;

  return (
    <div className={cn('mt-3 rounded-xl border p-3', result.valid ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50')}>
      <div className="flex items-center gap-2 mb-2">
        {result.valid
          ? <CircleCheck className="h-4 w-4 text-green-600" />
          : <TriangleAlert className="h-4 w-4 text-red-600" />
        }
        <p className={cn('text-xs font-bold', result.valid ? 'text-green-800' : 'text-red-800')}>
          {result.valid ? 'Validation passed' : 'Validation failed'}
        </p>
        <span className="text-xs text-gray-500 ml-auto">{file.rowCount ?? 0} rows · {file.errorCount ?? 0} errors · {file.warningCount ?? 0} warnings</span>
      </div>
      <p className="text-xs text-gray-700 mb-2">{result.summary}</p>
      {result.issues && result.issues.length > 0 && (
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {result.issues.map((issue, idx) => (
            <div key={idx} className={cn('flex items-start gap-2 text-[11px] px-2 py-1 rounded',
              issue.severity === 'ERROR' ? 'bg-red-100' : 'bg-amber-50')}>
              <span className={cn('font-bold flex-shrink-0', issue.severity === 'ERROR' ? 'text-red-700' : 'text-amber-700')}>
                {issue.severity}
              </span>
              <span className="text-gray-700">
                {issue.row && `Row ${issue.row}: `}
                {issue.column && `[${issue.column}] `}
                {issue.message}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Collection Item Card ─────────────────────────────────────────────────────

function CollectionItemCard({
  item,
  engagementId,
  onStatusChange,
}: {
  item: CollectionItem;
  engagementId: string;
  onStatusChange: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: files, refetch: refetchFiles } = useQuery<DataFile[]>({
    queryKey: ['dataFiles', item.id],
    queryFn: () => engagementsApi.listDataFiles(engagementId, item.id),
    enabled: expanded,
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => engagementsApi.updateDataCollectionItem(engagementId, item.id, data),
    onSuccess: () => onStatusChange(),
  });

  const markUploadedMutation = useMutation({
    mutationFn: () => engagementsApi.markDataUploaded(engagementId, item.id),
    onSuccess: () => onStatusChange(),
  });

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      await engagementsApi.uploadDataFile(engagementId, item.id, file);
      await refetchFiles();
      onStatusChange();
    } finally {
      setUploading(false);
    }
  };

  const handleValidate = async (fileId: string) => {
    setValidatingId(fileId);
    try {
      await engagementsApi.validateDataFile(engagementId, item.id, fileId);
      await refetchFiles();
      onStatusChange();
    } finally {
      setValidatingId(null);
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    await engagementsApi.deleteDataFile(engagementId, item.id, fileId);
    refetchFiles();
  };

  const downloadUrl = engagementsApi.getDataTemplateDownloadUrl(engagementId, item.id);

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          {expanded ? <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />}
          <FileSpreadsheet className="h-4 w-4 text-violet-400 flex-shrink-0" />
          <span className="text-sm font-semibold text-gray-900 truncate">{item.name}</span>
        </button>

        <div className="flex items-center gap-2 flex-shrink-0">
          <StatusBadge status={item.status} />

          {/* Quick actions */}
          <a
            href={downloadUrl}
            download
            className="flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
            title="Download template"
          >
            <Download className="h-3 w-3" />
          </a>

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1 px-2 py-1 rounded-lg border border-brand-200 text-xs text-brand-600 hover:bg-brand-50 transition-colors"
            title="Upload filled template"
          >
            {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) { handleUpload(file); e.target.value = ''; }
            }}
          />

          {/* Status dropdown */}
          <select
            value={item.status}
            onChange={(e) => updateMutation.mutate({ status: e.target.value })}
            className="text-[10px] border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-600 cursor-pointer"
          >
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-50">
          {/* Meta row */}
          <div className="flex items-center gap-4 py-3 text-xs text-gray-500">
            {item.fields && <span>{item.fields.length} fields · {item.fields.filter((f) => f.required).length} required</span>}
            {item.assignedTo && <span>Assigned: <strong>{item.assignedTo}</strong></span>}
            {item.dueDate && <span>Due: <strong>{new Date(item.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</strong></span>}
          </div>

          {/* Assignment + due date */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="text-[11px] text-gray-400 font-semibold mb-1 block">Assign to</label>
              <input
                type="text"
                defaultValue={item.assignedTo ?? ''}
                onBlur={(e) => updateMutation.mutate({ assignedTo: e.target.value })}
                placeholder="Client contact name..."
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>
            <div>
              <label className="text-[11px] text-gray-400 font-semibold mb-1 block">Due date</label>
              <input
                type="date"
                defaultValue={item.dueDate?.split('T')[0] ?? ''}
                onBlur={(e) => updateMutation.mutate({ dueDate: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>
          </div>

          {/* Uploaded files */}
          {files && files.length > 0 && (
            <div className="space-y-3 mb-3">
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Uploaded files</p>
              {files.map((f) => (
                <div key={f.id} className="border border-gray-100 rounded-xl p-3">
                  <div className="flex items-center gap-3">
                    <FileSpreadsheet className="h-4 w-4 text-green-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-800 truncate">{f.originalName}</p>
                      <p className="text-[10px] text-gray-400">
                        {(f.sizeBytes / 1024).toFixed(1)} KB · uploaded {new Date(f.createdAt).toLocaleDateString('en-GB')}
                        {f.uploadedBy && ` by ${f.uploadedBy}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Validation status */}
                      {f.validationStatus === 'PENDING' && (
                        <button
                          onClick={() => handleValidate(f.id)}
                          disabled={!!validatingId}
                          className="flex items-center gap-1 px-2 py-1 bg-brand-50 text-brand-700 rounded-lg text-[10px] font-semibold hover:bg-brand-100 transition-colors"
                        >
                          {validatingId === f.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                          Validate with AI
                        </button>
                      )}
                      {f.validationStatus === 'VALIDATING' && (
                        <span className="text-[10px] text-gray-400 flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" /> Validating...
                        </span>
                      )}
                      {f.validationStatus === 'VALID' && (
                        <span className="text-[10px] font-bold text-green-700 flex items-center gap-1">
                          <CircleCheck className="h-3 w-3" /> Valid
                        </span>
                      )}
                      {f.validationStatus === 'INVALID' && (
                        <button
                          onClick={() => handleValidate(f.id)}
                          className="flex items-center gap-1 text-[10px] font-bold text-red-600 hover:text-red-800"
                        >
                          <RefreshCw className="h-3 w-3" /> Re-validate
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteFile(f.id)}
                        className="p-1 text-gray-300 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {/* Validation result */}
                  {(f.validationStatus === 'VALID' || f.validationStatus === 'INVALID') && (
                    <ValidationPanel file={f} />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Mark uploaded to NS */}
          {item.status === 'VALIDATED' && (
            <button
              onClick={() => markUploadedMutation.mutate()}
              className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700 transition-colors w-full justify-center"
            >
              <CircleCheck className="h-3.5 w-3.5" />
              Mark as uploaded to NetSuite
            </button>
          )}

          {/* Notes */}
          <div className="mt-3">
            <label className="text-[11px] text-gray-400 font-semibold mb-1 flex items-center gap-1">
              <MessageSquare className="h-3 w-3" /> Notes
            </label>
            <textarea
              defaultValue={item.notes ?? ''}
              onBlur={(e) => updateMutation.mutate({ notes: e.target.value })}
              placeholder="Add notes for this template..."
              rows={2}
              className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Custom template dialog ───────────────────────────────────────────────────

function CustomTemplateDialog({ engagementId, onClose, onDone }: { engagementId: string; onClose: () => void; onDone: () => void }) {
  const [requirements, setRequirements] = useState('');
  const [questions, setQuestions] = useState<Array<{ key: string; question: string; type: string; options?: string[] }> | null>(null);
  const [qAnswers, setQAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!requirements.trim()) return;
    setLoading(true);
    setError('');
    try {
      const result = await engagementsApi.generateCustomTemplate(engagementId, { requirements, answers: qAnswers });
      if (result.needsMoreInfo) {
        setQuestions(result.questions);
      } else {
        onDone();
      }
    } catch {
      setError('Failed to generate template. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-brand-600" />
            <h2 className="text-sm font-bold text-gray-900">AI Custom Template</h2>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-700 mb-1.5 block">Describe what data you need to collect</label>
            <textarea
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              rows={4}
              placeholder="e.g. 'We need to collect vehicle fleet data including registration numbers, model, year, mileage, and assigned driver for the client's logistics operation'"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none"
            />
          </div>

          {/* Follow-up questions from AI */}
          {questions && questions.length > 0 && (
            <div className="space-y-3 bg-brand-50 border border-brand-100 rounded-xl p-4">
              <p className="text-xs font-bold text-brand-800">AI needs a few more details:</p>
              {questions.map((q) => (
                <div key={q.key}>
                  <label className="text-xs font-semibold text-gray-700 mb-1 block">{q.question}</label>
                  {q.type === 'select' && q.options ? (
                    <select
                      value={qAnswers[q.key] ?? ''}
                      onChange={(e) => setQAnswers((prev) => ({ ...prev, [q.key]: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400 bg-white"
                    >
                      <option value="">— select —</option>
                      {q.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={qAnswers[q.key] ?? ''}
                      onChange={(e) => setQAnswers((prev) => ({ ...prev, [q.key]: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400"
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={loading || !requirements.trim()}
            className={cn(
              'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all',
              loading || !requirements.trim()
                ? 'bg-gray-100 text-gray-400'
                : 'bg-brand-600 text-white hover:bg-brand-700',
            )}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {loading ? 'Generating...' : questions ? 'Generate with answers' : 'Generate template'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────

function DataCollectionSkeleton() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-5 pb-4 border-b border-gray-100 bg-white animate-pulse">
        <div className="flex items-center justify-between mb-4">
          <div className="space-y-1.5">
            <div className="h-4 bg-gray-100 rounded w-36" />
            <div className="h-3 bg-gray-100 rounded w-64" />
          </div>
          <div className="flex gap-2">
            <div className="h-8 bg-gray-100 rounded-lg w-28" />
            <div className="h-8 bg-gray-100 rounded-lg w-36" />
          </div>
        </div>
        <div className="flex gap-3">
          {[1,2,3,4,5].map((i) => <div key={i} className="h-5 bg-gray-100 rounded-full w-20" />)}
        </div>
      </div>
      <div className="flex-1 p-6 space-y-6">
        {[1,2].map((g) => (
          <div key={g} className="animate-pulse">
            <div className="h-3 bg-gray-100 rounded w-32 mb-3" />
            <div className="space-y-2">
              {[1,2,3].map((i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-100 h-14 flex items-center px-4 gap-3">
                  <div className="h-4 w-4 bg-gray-100 rounded" />
                  <div className="h-3.5 bg-gray-100 rounded flex-1 max-w-xs" />
                  <div className="h-5 bg-gray-100 rounded-full w-24 ml-auto" />
                  <div className="h-6 w-6 bg-gray-100 rounded" />
                  <div className="h-6 w-6 bg-gray-100 rounded" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Category accent colours ──────────────────────────────────────────────────

const CATEGORY_STYLE: Record<string, { bar: string; dot: string; label: string }> = {
  financial:     { bar: 'bg-blue-500',   dot: 'bg-blue-400',   label: 'text-blue-700'   },
  master:        { bar: 'bg-violet-500', dot: 'bg-violet-400', label: 'text-violet-700' },
  transactional: { bar: 'bg-amber-500',  dot: 'bg-amber-400',  label: 'text-amber-700'  },
  vertical:      { bar: 'bg-green-500',  dot: 'bg-green-400',  label: 'text-green-700'  },
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export function DataCollectionPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [showCustomDialog, setShowCustomDialog] = useState(false);

  const { data: items, isLoading } = useQuery<CollectionItem[]>({
    queryKey: ['dataCollection', id],
    queryFn: () => engagementsApi.listDataCollection(id!),
    enabled: !!id,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['dataCollection', id] });

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await engagementsApi.generateDataTemplates(id!);
      refresh();
    } finally {
      setGenerating(false);
    }
  };

  const grouped = CATEGORY_ORDER.reduce<Record<string, CollectionItem[]>>((acc, cat) => {
    acc[cat] = (items ?? []).filter((i) => i.category === cat);
    return acc;
  }, {});

  const total = items?.length ?? 0;
  const byStatus = {
    NOT_STARTED: (items ?? []).filter((i) => i.status === 'NOT_STARTED').length,
    SENT:        (items ?? []).filter((i) => i.status === 'SENT').length,
    RECEIVED:    (items ?? []).filter((i) => i.status === 'RECEIVED').length,
    VALIDATED:   (items ?? []).filter((i) => i.status === 'VALIDATED').length,
    UPLOADED:    (items ?? []).filter((i) => i.status === 'UPLOADED').length,
  };
  const uploadedPct = total > 0 ? Math.round((byStatus.UPLOADED / total) * 100) : 0;

  if (isLoading) return <DataCollectionSkeleton />;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-gray-100 bg-white">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-base font-black text-gray-900">Data Collection</h1>
            <p className="text-xs text-gray-400 mt-0.5">Manage, track, and validate all client data for this implementation</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCustomDialog(true)}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-50 hover:border-gray-300 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Custom template
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all shadow-sm',
                generating ? 'bg-gray-100 text-gray-400' : 'bg-brand-600 text-white hover:bg-brand-700 active:scale-95',
              )}
            >
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {generating ? 'Generating...' : total === 0 ? 'Generate AI templates' : 'Regenerate templates'}
            </button>
          </div>
        </div>

        {/* Pipeline status bar */}
        {total > 0 && (
          <div className="space-y-2.5">
            <div className="flex items-center gap-3 flex-wrap">
              {Object.entries(STATUS_CONFIG).map(([k, v]) => {
                const count = byStatus[k as keyof typeof byStatus] ?? 0;
                if (count === 0) return null;
                return (
                  <div key={k} className={cn('flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold', v.color)}>
                    <v.icon className="h-2.5 w-2.5" />
                    {count} {v.label}
                  </div>
                );
              })}
              <div className="ml-auto flex items-center gap-2">
                <span className="text-[10px] text-gray-400">{uploadedPct}% complete</span>
              </div>
            </div>
            {/* Segmented progress bar */}
            <div className="flex h-1.5 rounded-full overflow-hidden gap-0.5">
              {(Object.keys(STATUS_CONFIG) as Array<keyof typeof STATUS_CONFIG>).map((k) => {
                const count = byStatus[k as keyof typeof byStatus] ?? 0;
                const w = total > 0 ? (count / total) * 100 : 0;
                if (w === 0) return null;
                const barColor: Record<string, string> = {
                  NOT_STARTED: 'bg-gray-200', SENT: 'bg-blue-300',
                  RECEIVED: 'bg-violet-400', VALIDATED: 'bg-amber-400', UPLOADED: 'bg-green-500',
                };
                return (
                  <div
                    key={k}
                    className={cn('h-full transition-all duration-700 rounded-sm', barColor[k])}
                    style={{ width: `${w}%` }}
                    title={`${STATUS_CONFIG[k].label}: ${count}`}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-7">
        {total === 0 ? (
          <div className="flex flex-col items-center justify-center h-80 text-center">
            <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-brand-50 to-blue-50 flex items-center justify-center mb-5 shadow-sm">
              <Sparkles className="h-9 w-9 text-brand-400" />
            </div>
            <h2 className="text-base font-bold text-gray-800 mb-2">No templates yet</h2>
            <p className="text-sm text-gray-400 max-w-xs mb-6">
              Generate AI-customised templates based on this engagement's questionnaire answers and industry vertical.
            </p>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center gap-2 px-6 py-3 bg-brand-600 text-white rounded-xl font-bold text-sm hover:bg-brand-700 active:scale-95 transition-all shadow-md shadow-brand-200"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {generating ? 'Generating templates...' : 'Generate AI templates'}
            </button>
          </div>
        ) : (
          CATEGORY_ORDER.map((cat) => {
            const catItems = grouped[cat];
            if (catItems.length === 0) return null;
            const style = CATEGORY_STYLE[cat] ?? { bar: 'bg-gray-400', dot: 'bg-gray-300', label: 'text-gray-600' };
            const uploadedInCat = catItems.filter((i) => i.status === 'UPLOADED').length;
            return (
              <div key={cat}>
                {/* Category header */}
                <div className="flex items-center gap-3 mb-3">
                  <div className={cn('w-1 h-5 rounded-full flex-shrink-0', style.bar)} />
                  <h2 className={cn('text-xs font-black uppercase tracking-wider', style.label)}>
                    {CATEGORY_LABELS[cat]}
                  </h2>
                  <div className="flex-1 h-px bg-gray-100" />
                  <span className="text-[10px] text-gray-400 font-semibold tabular-nums">
                    {uploadedInCat}/{catItems.length} uploaded
                  </span>
                </div>
                <div className="space-y-2">
                  {catItems.map((item) => (
                    <CollectionItemCard
                      key={item.id}
                      item={item}
                      engagementId={id!}
                      onStatusChange={refresh}
                    />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {showCustomDialog && (
        <CustomTemplateDialog
          engagementId={id!}
          onClose={() => setShowCustomDialog(false)}
          onDone={() => {
            setShowCustomDialog(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}
