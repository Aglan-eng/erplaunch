/**
 * Pure helpers for the JobBrowserPage (Phase 39.3).
 *
 * Kept separate so the file-classification + path-formatting logic is
 * testable without standing up @testing-library. The React surface layers
 * on top consume these and add tree state + preview rendering.
 */

export interface FileTreeNode {
  name: string;
  type: 'dir' | 'file';
  size?: number;
  children?: FileTreeNode[];
}

/**
 * Classify a filename by extension into the preview-modes the SPA can
 * render natively:
 *   - 'html'   → iframe (sandboxed)
 *   - 'markdown' → markdown-it rendering
 *   - 'json'   → pretty-printed in a <pre>
 *   - 'csv'    → table view
 *   - 'code'   → monospace <pre> with the full text
 *   - 'image'  → <img>
 *   - 'pdf'    → <iframe> (browser native PDF viewer)
 *   - 'binary' → download CTA only
 */
export type PreviewKind = 'html' | 'markdown' | 'json' | 'csv' | 'code' | 'image' | 'pdf' | 'binary';

const CODE_EXTS = new Set([
  '.txt', '.js', '.ts', '.tsx', '.jsx', '.xml', '.sql', '.yml', '.yaml',
  '.sh', '.bat', '.ps1', '.css', '.html.tmpl',
]);

export function classifyFile(filename: string): PreviewKind {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.svg') || lower.endsWith('.webp') || lower.endsWith('.gif')) {
    return 'image';
  }
  for (const ext of CODE_EXTS) {
    if (lower.endsWith(ext)) return 'code';
  }
  return 'binary';
}

/**
 * Format bytes as a human-readable size: "1.2 KB", "3.4 MB", etc.
 * Matches what the consultant expects to see next to a file in a tree.
 */
export function formatBytes(bytes: number | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, idx);
  // Drop the decimal when the unit is bytes; show 1 decimal otherwise.
  const formatted = idx === 0 ? Math.round(value).toString() : value.toFixed(1);
  return `${formatted} ${units[idx]}`;
}

/**
 * Count files (not folders) recursively in a tree. Powers the "X files"
 * summary at the top of the file browser.
 */
export function countFiles(node: FileTreeNode): number {
  if (node.type === 'file') return 1;
  return (node.children ?? []).reduce((sum, c) => sum + countFiles(c), 0);
}

/**
 * Flatten a tree into [{ path, node }] pairs for keyboard navigation /
 * search-by-name. The path is forward-slash separated and starts at the
 * root's children (the root itself has an empty name in the API response).
 */
export function flattenTree(
  root: FileTreeNode,
  prefix = '',
): Array<{ path: string; node: FileTreeNode }> {
  const out: Array<{ path: string; node: FileTreeNode }> = [];
  for (const child of root.children ?? []) {
    const childPath = prefix ? `${prefix}/${child.name}` : child.name;
    out.push({ path: childPath, node: child });
    if (child.type === 'dir') {
      out.push(...flattenTree(child, childPath));
    }
  }
  return out;
}
