import { describe, it, expect } from 'vitest';
import { validateAdaptor } from '@ofoq/adaptor-sdk';
import { AdaptorRegistry } from '@ofoq/adaptor-registry';
import netsuiteAdaptor from '../src/index.js';

describe('netsuiteAdaptor: manifest', () => {
  it('has the expected identity', () => {
    expect(netsuiteAdaptor.manifest.id).toBe('netsuite');
    expect(netsuiteAdaptor.manifest.sourceKind).toBe('built-in');
    expect(netsuiteAdaptor.manifest.vendor).toBe('Oracle');
    expect(netsuiteAdaptor.manifest.capabilities).toContain('document');
    expect(netsuiteAdaptor.manifest.capabilities).toContain('script');
    expect(netsuiteAdaptor.manifest.capabilities).toContain('workflow');
  });

  it('passes SDK shape validation', () => {
    const res = validateAdaptor(netsuiteAdaptor);
    expect(res.ok, res.errors.join('; ')).toBe(true);
  });
});

describe('netsuiteAdaptor: schema', () => {
  it('exposes 5 flows in the canonical order', () => {
    const ids = netsuiteAdaptor.schema.flows.map((f) => f.id);
    expect(ids).toEqual(['R2R', 'P2P', 'O2C', 'PRODUCTION', 'RETURNS']);
  });

  it('every flow has at least one section with at least one question', () => {
    for (const flow of netsuiteAdaptor.schema.flows) {
      expect(flow.sections.length, `flow ${flow.id} has no sections`).toBeGreaterThan(0);
      for (const section of flow.sections) {
        expect(section.questions.length, `section ${flow.id}/${section.id} has no questions`).toBeGreaterThan(0);
      }
    }
  });

  it('question IDs are namespaced and unique', () => {
    const seen = new Set<string>();
    for (const flow of netsuiteAdaptor.schema.flows) {
      for (const section of flow.sections) {
        for (const q of section.questions) {
          expect(q.id).toMatch(/^[a-z0-9]+\.[a-zA-Z0-9]+\.[a-zA-Z0-9]+/);
          expect(seen.has(q.id), `duplicate question id: ${q.id}`).toBe(false);
          seen.add(q.id);
        }
      }
    }
  });
});

describe('netsuiteAdaptor: license', () => {
  it('includes Starter, Mid-Market, OneWorld editions', () => {
    const ids = netsuiteAdaptor.license.editions.map((e) => e.id);
    expect(ids).toEqual(['STARTER', 'MID_MARKET', 'ONEWORLD']);
  });

  it('default edition is MID_MARKET', () => {
    expect(netsuiteAdaptor.license.defaultEditionId).toBe('MID_MARKET');
  });

  it('lists ONEWORLD and MANUFACTURING in the module catalog', () => {
    const modIds = netsuiteAdaptor.license.modules.map((m) => m.id);
    expect(modIds).toContain('ONEWORLD');
    expect(modIds).toContain('MANUFACTURING');
  });
});

describe('netsuiteAdaptor: phases + generators', () => {
  it('default phases include Discovery through Go Live in order', () => {
    const order = netsuiteAdaptor.phases.defaultPhases.map((p) => p.label);
    expect(order).toEqual(['Discovery', 'Scoping', 'Build', 'UAT', 'Go Live']);
  });

  it('ships the eight known generators', () => {
    const genIds = netsuiteAdaptor.generators.map((g) => g.id).sort();
    expect(genIds).toEqual(
      ['brd', 'plan', 'risk', 'sdf', 'solution-doc', 'suitescript', 'training-manual', 'uat'].sort(),
    );
  });
});

describe('AdaptorRegistry', () => {
  it('registers + retrieves + refuses to register twice', () => {
    const reg = new AdaptorRegistry();
    reg.register(netsuiteAdaptor);
    expect(reg.has('netsuite')).toBe(true);
    expect(reg.get('netsuite').manifest.id).toBe('netsuite');
    expect(() => reg.register(netsuiteAdaptor)).toThrow(/already registered/);
  });

  it('get() throws on unknown id, find() returns null', () => {
    const reg = new AdaptorRegistry();
    expect(() => reg.get('does-not-exist')).toThrow(/unknown adaptor/);
    expect(reg.find('does-not-exist')).toBeNull();
  });

  it('list() returns manifests in registration order', () => {
    const reg = new AdaptorRegistry();
    reg.register(netsuiteAdaptor);
    const listed = reg.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe('netsuite');
    expect(listed[0].name).toBe('NetSuite');
    expect(listed[0].sourceKind).toBe('built-in');
  });

  it('rejects an adaptor that fails validation', () => {
    const reg = new AdaptorRegistry();
    const malformed = { manifest: { id: 'bad' } } as never;
    expect(() => reg.register(malformed)).toThrow(/invalid adaptor/);
  });
});
