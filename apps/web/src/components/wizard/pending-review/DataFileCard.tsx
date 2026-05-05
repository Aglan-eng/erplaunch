import React, { useState } from 'react';
import { Check, X, MessageSquare, FileText, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  registerCardRenderer,
  type CardRendererProps,
} from './cardRenderers';

/**
 * DataFileCard (Phase 30).
 *
 * Renders a pending DATA_FILE submission with file metadata + a
 * download link to preview the staged file before deciding. The staged
 * file lives at UPLOADS_DIR/staged/<filename>; download streams it back
 * via GET /api/v1/engagements/:id/staged-files/:stagedFileId/download.
 *
 * After accept: file moves to permanent storage + DataFile row created.
 * After reject: staged file deleted from disk + DB row.
 */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DataFileCard({ submission, onAccept, onReject, isReviewing }: CardRendererProps) {
  const [comment, setComment] = useState('');
  const payload = submission.payload as {
    stagedFileId?: string;
    dataCollectionItemId?: string;
    originalFilename?: string;
    sizeBytes?: number;
  };

  const downloadUrl = payload.stagedFileId
    ? `/api/v1/engagements/${submission.engagementId}/staged-files/${payload.stagedFileId}/download`
    : null;

  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      data-testid={`data-file-card-${submission.id}`}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Data file upload
          </p>
          <p className="mt-0.5 text-sm font-bold text-slate-900">
            {submission.memberName ?? 'Client'}{' '}
            <span className="font-normal text-slate-500">uploaded a file</span>
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {new Date(submission.createdAt).toLocaleString('en-GB', {
              day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </p>
        </div>
      </div>

      {/* File metadata + download */}
      <div className="rounded-xl bg-slate-50/70 border border-slate-100 p-4 mb-4 flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
          <FileText className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">
            {payload.originalFilename ?? 'unnamed file'}
          </p>
          <p className="text-xs text-slate-500">
            {formatBytes(payload.sizeBytes ?? 0)}
            {payload.dataCollectionItemId && (
              <>
                <span className="mx-1.5 text-slate-300">·</span>
                <span className="font-mono text-[10px]">
                  item {String(payload.dataCollectionItemId).slice(0, 8)}…
                </span>
              </>
            )}
          </p>
        </div>
        {downloadUrl && (
          <a
            href={downloadUrl}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:text-blue-600 hover:border-blue-200 transition-colors"
            data-testid={`data-file-download-${submission.id}`}
          >
            <Download className="h-3.5 w-3.5" />
            Preview
          </a>
        )}
      </div>

      <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
        <MessageSquare className="inline h-3 w-3 mr-1" />
        Comment (optional)
      </label>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Optional — visible to client in the audit log"
        rows={2}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50 transition-shadow mb-3"
        data-testid={`data-file-comment-${submission.id}`}
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={isReviewing}
          onClick={() => onAccept(comment)}
          className={cn(
            'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors',
            'bg-emerald-600 text-white hover:bg-emerald-700',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
          data-testid={`data-file-accept-${submission.id}`}
        >
          <Check className="h-3.5 w-3.5" />
          Accept
        </button>
        <button
          type="button"
          disabled={isReviewing}
          onClick={() => onReject(comment)}
          className={cn(
            'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors',
            'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-rose-600 hover:border-rose-200',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
          data-testid={`data-file-reject-${submission.id}`}
        >
          <X className="h-3.5 w-3.5" />
          Reject
        </button>
      </div>
    </div>
  );
}

registerCardRenderer('DATA_FILE', DataFileCard);

export default DataFileCard;
