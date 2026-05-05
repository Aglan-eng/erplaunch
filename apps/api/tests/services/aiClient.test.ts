import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getAnthropicClient } from '../../src/services/aiClient.js';

const ORIGINAL_KEY = process.env.AI_API_KEY;
const ORIGINAL_LEGACY = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  delete process.env.AI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  if (ORIGINAL_KEY !== undefined) process.env.AI_API_KEY = ORIGINAL_KEY;
  else delete process.env.AI_API_KEY;
  if (ORIGINAL_LEGACY !== undefined) process.env.ANTHROPIC_API_KEY = ORIGINAL_LEGACY;
  else delete process.env.ANTHROPIC_API_KEY;
});

describe('getAnthropicClient — explicit AI_API_KEY wiring', () => {
  it('returns null when AI_API_KEY is unset', () => {
    expect(getAnthropicClient()).toBeNull();
  });

  it('returns a client when AI_API_KEY is set', () => {
    process.env.AI_API_KEY = 'sk-ant-test-fake-key';
    const client = getAnthropicClient();
    expect(client).not.toBeNull();
    // Anthropic SDK exposes the key via its constructor — we don't crack it
    // open here; presence of the client object is sufficient evidence the
    // key was forwarded.
    expect(typeof client?.messages?.create).toBe('function');
  });

  it('does NOT silently fall back to ANTHROPIC_API_KEY when AI_API_KEY is unset', () => {
    // Phase 37.4 invariant: we no longer rely on the SDK's default
    // ANTHROPIC_API_KEY lookup. If the deployment only sets the legacy
    // var, the client factory still returns null and the caller gets a
    // clear "AI not configured" surface.
    process.env.ANTHROPIC_API_KEY = 'sk-ant-legacy-fake';
    expect(getAnthropicClient()).toBeNull();
  });

  it('returns null when AI_API_KEY is empty string', () => {
    process.env.AI_API_KEY = '';
    expect(getAnthropicClient()).toBeNull();
  });
});
