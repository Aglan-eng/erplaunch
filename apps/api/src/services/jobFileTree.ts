/**
 * Phase 39.3 — file-tree + per-file lookup for the deliverable browser UI.
 *
 * The /jobs/:jobId/files endpoint recursively walks the job's output dir,
 * returns a JSON tree of folders and file metadata (name + size, no
 * content). The /jobs/:jobId/files/* endpoint reads a single file with a
 * strict path-traversal guard: the resolved real path MUST be inside the
 * job's output directory. Any `..` segment that would escape is rejected.
 */
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

export interface FileTreeNode {
  name: string;
  type: 'dir' | 'file';
  size?: number;
  children?: FileTreeNode[];
}

/**
 * Recursively walk a directory and return the tree shape. Files inside
 * `node_modules` or hidden dotfiles are skipped — neither should appear in
 * a generation output dir but the filter is cheap defense in depth.
 */
export async function buildFileTree(rootDir: string): Promise<FileTreeNode> {
  const stat = await fs.stat(rootDir);
  if (!stat.isDirectory()) {
    throw new Error(`buildFileTree: ${rootDir} is not a directory`);
  }
  return walk(rootDir, '');
}

async function walk(absPath: string, displayName: string): Promise<FileTreeNode> {
  const entries = await fs.readdir(absPath, { withFileTypes: true });
  const children: FileTreeNode[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules') continue;
    const childPath = path.join(absPath, entry.name);
    if (entry.isDirectory()) {
      children.push(await walk(childPath, entry.name));
    } else if (entry.isFile()) {
      const childStat = await fs.stat(childPath);
      children.push({ name: entry.name, type: 'file', size: childStat.size });
    }
  }
  // Stable sort: directories first, then alphabetically.
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { name: displayName, type: 'dir', children };
}

/**
 * Resolve a relative path inside a base directory with a traversal guard.
 * Returns the absolute path when safe, or null when:
 *   - the request path contains a normalised `..` that escapes baseDir
 *   - the resolved file does not exist
 */
export function resolveSafePath(baseDir: string, requestPath: string): string | null {
  // Normalise the request path. URL-encoded `..` arrived here as `..` after
  // Fastify's path parsing; we still defend against any leftover encodings.
  const decoded = decodeURIComponent(requestPath);
  const joined = path.join(baseDir, decoded);
  const resolved = path.resolve(joined);
  const resolvedBase = path.resolve(baseDir);
  // Must be the base dir itself or a descendant.
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
    return null;
  }
  if (!fsSync.existsSync(resolved)) return null;
  const stat = fsSync.statSync(resolved);
  if (!stat.isFile()) return null;
  return resolved;
}

/**
 * MIME type for a given file extension. Coarse but correct for the file
 * shapes the generation pipeline emits (markdown / HTML / JSON / XML /
 * SuiteScript / SQL / CSV / TXT / PDF / DOCX).
 */
export function mimeForExtension(absPath: string): string {
  const ext = path.extname(absPath).toLowerCase();
  switch (ext) {
    case '.md':       return 'text/markdown; charset=utf-8';
    case '.html':     return 'text/html; charset=utf-8';
    case '.htm':      return 'text/html; charset=utf-8';
    case '.json':     return 'application/json; charset=utf-8';
    case '.xml':      return 'application/xml; charset=utf-8';
    case '.csv':      return 'text/csv; charset=utf-8';
    case '.txt':      return 'text/plain; charset=utf-8';
    case '.js':       return 'application/javascript; charset=utf-8';
    case '.ts':       return 'application/typescript; charset=utf-8';
    case '.sql':      return 'application/sql; charset=utf-8';
    case '.yml':
    case '.yaml':     return 'application/yaml; charset=utf-8';
    case '.pdf':      return 'application/pdf';
    case '.docx':     return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.xlsx':     return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.zip':      return 'application/zip';
    case '.png':      return 'image/png';
    case '.jpg':
    case '.jpeg':     return 'image/jpeg';
    case '.svg':      return 'image/svg+xml';
    default:          return 'application/octet-stream';
  }
}
