import type { PlatformAdaptor } from '@ofoq/adaptor-sdk';
import { validateAdaptor } from '@ofoq/adaptor-sdk';

/**
 * In-process adaptor registry. Built-in adaptors register once at boot;
 * custom adaptors (tenant-authored) can register dynamically when a firm's
 * workspace loads.
 *
 * Single-process, in-memory — fine for pilot. When we scale out, the registry
 * becomes a thin wrapper over a shared store (Redis or the DB) that each API
 * instance reads from.
 */
export class AdaptorRegistry {
  private adaptors = new Map<string, PlatformAdaptor>();

  register(adaptor: PlatformAdaptor): void {
    const res = validateAdaptor(adaptor);
    if (!res.ok) {
      throw new Error(`AdaptorRegistry.register: invalid adaptor — ${res.errors.join('; ')}`);
    }
    const { id } = adaptor.manifest;
    if (this.adaptors.has(id)) {
      throw new Error(`AdaptorRegistry.register: adaptor id "${id}" already registered`);
    }
    this.adaptors.set(id, adaptor);
  }

  has(id: string): boolean {
    return this.adaptors.has(id);
  }

  /** Throws if the adaptor is unknown — use `has` or `find` for soft lookup. */
  get(id: string): PlatformAdaptor {
    const a = this.adaptors.get(id);
    if (!a) {
      throw new Error(`AdaptorRegistry.get: unknown adaptor "${id}"`);
    }
    return a;
  }

  find(id: string): PlatformAdaptor | null {
    return this.adaptors.get(id) ?? null;
  }

  list(): AdaptorListing[] {
    return Array.from(this.adaptors.values()).map((a) => ({
      id: a.manifest.id,
      name: a.manifest.name,
      tagline: a.manifest.tagline,
      version: a.manifest.version,
      vendor: a.manifest.vendor,
      capabilities: a.manifest.capabilities,
      sourceKind: a.manifest.sourceKind,
    }));
  }

  /** Test helper: clear all registered adaptors. */
  _resetForTests(): void {
    this.adaptors.clear();
  }
}

export interface AdaptorListing {
  id: string;
  name: string;
  tagline?: string;
  version: string;
  vendor: string;
  capabilities: string[];
  sourceKind: 'built-in' | 'custom' | 'marketplace';
}

/**
 * Process-wide singleton. Every built-in adaptor package calls
 * `registerBuiltinAdaptor()` at boot.
 */
let _global: AdaptorRegistry | null = null;

export function getAdaptorRegistry(): AdaptorRegistry {
  if (!_global) _global = new AdaptorRegistry();
  return _global;
}

export function registerBuiltinAdaptor(adaptor: PlatformAdaptor): void {
  getAdaptorRegistry().register(adaptor);
}
