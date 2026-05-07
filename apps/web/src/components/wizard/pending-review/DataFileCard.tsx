import React from 'react';
import { FileText, Download } from 'lucide-react';
import {
  registerCardRenderer,
  type CardRendererProps,
} from './cardRenderers';
import { ReviewActions } from './ReviewActions';

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
          // Phase 41.2 — open in a new tab so the consultant can flip
          // back to the queue without losing their place. Renamed
          // "Preview" → "Download" to match what the link actually
          // does (the audit flagged the verb mismatch as a friction
          // point — no inline preview yet, so the label should be
          // honest about it).
          <a
            href={downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:text-blue-600 hover:border-blue-200 transition-colors"
            data-testid={`data-file-download-${submission.id}`}
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </a>
        )}
      </div>

      <ReviewActions
        submissionId={submission.id}
        testIdPrefix="data-file"
        isReviewing={isReviewing}
        onAccept={onAccept}
        onReject={onReject}
      />
    </div>
  );
}

registerCardRenderer('DATA_FILE', DataFileCard);

export default DataFileCard;
