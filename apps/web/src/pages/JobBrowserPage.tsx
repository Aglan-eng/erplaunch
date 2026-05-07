import React, { useState, useMemo, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, Folder, FolderOpen, FileText, Download, Loader, ChevronRight, ChevronDown, FileCode, FileJson,
} from 'lucide-react';
import MarkdownIt from 'markdown-it';
import { engagementsApi } from '@/lib/api';
import {
  classifyFile, formatBytes, countFiles, type FileTreeNode, type PreviewKind,
} from './jobBrowser';

/**
 * Phase 39.3 — deliverable browser. Sidebar shows the file tree the API
 * returns; clicking a file loads it in the preview pane via per-extension
 * rendering. Per-file Download button and a "Download all (ZIP)" link to
 * the existing /jobs/:jobId/download endpoint.
 */

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

// ─── Tree node ───────────────────────────────────────────────────────────────
interface TreeNodeProps {
  node: FileTreeNode;
  fullPath: string;
  selectedPath: string | null;
  onSelect: (path: string, node: FileTreeNode) => void;
  depth: number;
}

function TreeNode({ node, fullPath, selectedPath, onSelect, depth }: TreeNodeProps) {
  const [open, setOpen] = useState(depth < 2);
  const isFile = node.type === 'file';
  const isSelected = selectedPath === fullPath;

  if (isFile) {
    return (
      <button
        type="button"
        onClick={() => onSelect(fullPath, node)}
        className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-left transition-colors text-xs ${
          isSelected
            ? 'bg-brand-50 text-brand-700 font-semibold'
            : 'text-gray-600 hover:bg-gray-50'
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
        title={node.name}
      >
        <FileIcon name={node.name} className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
        <span className="flex-1 truncate">{node.name}</span>
        <span className="text-[10px] text-gray-400 tabular-nums flex-shrink-0">
          {formatBytes(node.size)}
        </span>
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1 px-2 py-1 rounded-md text-left transition-colors text-xs font-semibold text-gray-700 hover:bg-gray-50"
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {open
          ? <ChevronDown className="h-3 w-3 text-gray-400 flex-shrink-0" />
          : <ChevronRight className="h-3 w-3 text-gray-400 flex-shrink-0" />}
        {open
          ? <FolderOpen className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
          : <Folder className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />}
        <span className="flex-1 truncate">{node.name || '/'}</span>
      </button>
      {open && (node.children ?? []).map((child) => {
        const childPath = fullPath ? `${fullPath}/${child.name}` : child.name;
        return (
          <TreeNode
            key={childPath}
            node={child}
            fullPath={childPath}
            selectedPath={selectedPath}
            onSelect={onSelect}
            depth={depth + 1}
          />
        );
      })}
    </>
  );
}

function FileIcon({ name, className }: { name: string; className?: string }) {
  const kind = classifyFile(name);
  if (kind === 'code') return <FileCode className={className} />;
  if (kind === 'json') return <FileJson className={className} />;
  return <FileText className={className} />;
}

// ─── Preview pane ────────────────────────────────────────────────────────────
interface PreviewProps {
  engagementId: string;
  jobId: string;
  selectedPath: string | null;
  selectedNode: FileTreeNode | null;
}

function Preview({ engagementId, jobId, selectedPath, selectedNode }: PreviewProps) {
  if (!selectedPath || !selectedNode) {
    return (
      <div className="h-full flex items-center justify-center text-center text-gray-400 text-sm">
        Pick a file from the tree to preview it.
      </div>
    );
  }

  const kind = classifyFile(selectedNode.name);
  const url = engagementsApi.jobFileUrl(engagementId, jobId, selectedPath);

  return (
    <div className="h-full flex flex-col">
      <PreviewHeader path={selectedPath} kind={kind} url={url} size={selectedNode.size} />
      <div className="flex-1 overflow-auto bg-white">
        <PreviewBody url={url} kind={kind} />
      </div>
    </div>
  );
}

function PreviewHeader({ path, kind, url, size }: { path: string; kind: PreviewKind; url: string; size?: number }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-gray-100 bg-gray-50/60">
      <div className="min-w-0 flex items-center gap-2">
        <FileIcon name={path.split('/').pop() ?? ''} className="h-4 w-4 text-gray-400 flex-shrink-0" />
        <code className="text-xs text-gray-700 truncate">{path}</code>
        {size !== undefined && (
          <span className="text-[10px] text-gray-400 tabular-nums flex-shrink-0">{formatBytes(size)}</span>
        )}
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide flex-shrink-0">{kind}</span>
      </div>
      <a
        href={url}
        download={path.split('/').pop()}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-800 px-2 py-1 rounded-md hover:bg-white transition-colors"
      >
        <Download className="h-3.5 w-3.5" />
        Download
      </a>
    </div>
  );
}

function PreviewBody({ url, kind }: { url: string; kind: PreviewKind }) {
  if (kind === 'html') {
    // sandboxed: scripts disabled, no top-nav, no form submission. Same-origin
    // is granted so styles and same-host assets resolve.
    return <iframe title="HTML preview" src={url} className="w-full h-full" sandbox="allow-same-origin" />;
  }
  if (kind === 'pdf') {
    return <iframe title="PDF preview" src={url} className="w-full h-full" />;
  }
  if (kind === 'image') {
    return (
      <div className="p-6 flex items-center justify-center">
        <img src={url} alt="Preview" className="max-w-full max-h-[80vh] rounded-lg border border-gray-200 shadow-sm" />
      </div>
    );
  }
  if (kind === 'binary') {
    return (
      <div className="h-full flex items-center justify-center text-center text-sm text-gray-500 px-6">
        Binary file — preview unavailable. Use the Download button above.
      </div>
    );
  }
  // markdown / json / csv / code → fetch text and render
  return <TextPreview url={url} kind={kind} />;
}

function TextPreview({ url, kind }: { url: string; kind: PreviewKind }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(null);
    setError(null);
    fetch(url, { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then(setText)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load file'));
  }, [url]);

  if (error) {
    return <div className="p-6 text-sm text-red-600">Failed to load file: {error}</div>;
  }
  if (text === null) {
    return (
      <div className="p-6 flex items-center gap-2 text-sm text-gray-400">
        <Loader className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  if (kind === 'markdown') {
    return (
      <article
        className="prose prose-sm max-w-none p-6"
        // markdown rendered locally via markdown-it; raw HTML in source is
        // disabled (html: false in the MarkdownIt options above) so the
        // output is sanitised by markdown-it itself.
        dangerouslySetInnerHTML={{ __html: md.render(text) }}
      />
    );
  }
  if (kind === 'json') {
    let pretty = text;
    try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw on parse failure */ }
    return <pre className="p-6 text-xs font-mono text-gray-800 whitespace-pre-wrap">{pretty}</pre>;
  }
  if (kind === 'csv') {
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    const rows = lines.slice(0, 200).map((l) => splitCsvLine(l));
    return (
      <div className="p-4 overflow-auto">
        <table className="text-xs border-collapse">
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={i === 0 ? 'bg-gray-50 font-bold' : ''}>
                {row.map((cell, j) => (
                  <td key={j} className="border border-gray-200 px-2 py-1 align-top whitespace-pre-wrap">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {lines.length > 200 && (
          <p className="mt-2 text-[10px] text-gray-400">Showing first 200 of {lines.length} rows. Download to see the full file.</p>
        )}
      </div>
    );
  }
  // code / fallback — monospace pre
  return <pre className="p-6 text-xs font-mono text-gray-800 whitespace-pre-wrap">{text}</pre>;
}

function splitCsvLine(line: string): string[] {
  // Minimal CSV splitter for preview. Handles quoted fields with embedded
  // commas; doesn't unescape doubled quotes (rare in generated files).
  const out: string[] = [];
  let buf = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (c === ',' && !inQuotes) { out.push(buf); buf = ''; continue; }
    buf += c;
  }
  out.push(buf);
  return out;
}

// ─── Page ────────────────────────────────────────────────────────────────────
export function JobBrowserPage() {
  const { id, jobId } = useParams<{ id: string; jobId: string }>();
  const navigate = useNavigate();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<FileTreeNode | null>(null);

  const { data: tree, isLoading } = useQuery({
    queryKey: ['job-files', id, jobId],
    queryFn: () => engagementsApi.listJobFiles(id!, jobId!) as Promise<FileTreeNode>,
    enabled: !!id && !!jobId,
  });

  const fileCount = useMemo(() => (tree ? countFiles(tree) : 0), [tree]);
  const downloadAllUrl = useMemo(() => {
    if (!id || !jobId) return null;
    const base = (engagementsApi.jobFileUrl(id, jobId, '_').slice(0, -1));
    // Strip the trailing path segment we passed in to derive the parent.
    return base.replace(/\/files\/$/, '/download');
  }, [id, jobId]);

  if (!id || !jobId) {
    return <div className="min-h-screen p-8 text-sm text-red-600">Missing engagement or job id.</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-20 flex-shrink-0">
        <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`/engagements/${id}/wizard`)}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-all active:scale-95"
              title="Back to wizard"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-sm font-black text-slate-900 tracking-tight">Generated Bundle</h1>
              <p className="text-[11px] text-gray-400">
                Job <code className="text-gray-500">{jobId}</code> · {fileCount} file{fileCount === 1 ? '' : 's'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to={`/engagements/${id}/wizard`}
              className="text-sm text-gray-500 hover:text-gray-900 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >
              ← Back to wizard
            </Link>
            {downloadAllUrl && (
              <a
                href={downloadAllUrl}
                download={`${jobId}.zip`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-700 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Download all (ZIP)
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-4 flex gap-4">
        <aside className="w-72 flex-shrink-0 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
          <div className="px-4 py-2.5 border-b border-gray-100 text-[10px] font-black text-gray-500 uppercase tracking-widest">
            Files
          </div>
          <div className="flex-1 overflow-auto py-2">
            {isLoading && <div className="p-4 text-xs text-gray-400">Loading…</div>}
            {!isLoading && tree && (
              (tree.children ?? []).length === 0 ? (
                <div className="p-4 text-xs text-gray-400">
                  No files yet. The job hasn't generated any deliverables.
                </div>
              ) : (
                (tree.children ?? []).map((child) => (
                  <TreeNode
                    key={child.name}
                    node={child}
                    fullPath={child.name}
                    selectedPath={selectedPath}
                    onSelect={(p, n) => { setSelectedPath(p); setSelectedNode(n); }}
                    depth={0}
                  />
                ))
              )
            )}
          </div>
        </aside>

        <section className="flex-1 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <Preview engagementId={id} jobId={jobId} selectedPath={selectedPath} selectedNode={selectedNode} />
        </section>
      </main>
    </div>
  );
}
