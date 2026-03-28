/**
 * Unit tests for utility functions.
 *
 * Covers text processing (normalisation, truncation),
 * content hashing, and timestamp generation.
 */

import { describe, it, expect } from 'vitest';
import { normaliseEntityName, truncate, nowISO } from '../../src/utils/text.js';
import { contentHash } from '../../src/utils/hash.js';

// ── contentHash ──

describe('contentHash', () => {
  it('produces a consistent hash for the same content', () => {
    const hash1 = contentHash('hello world');
    const hash2 = contentHash('hello world');
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different content', () => {
    const hash1 = contentHash('hello world');
    const hash2 = contentHash('hello world!');
    expect(hash1).not.toBe(hash2);
  });

  it('returns a hex string of 64 characters (SHA-256)', () => {
    const hash = contentHash('test');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles empty string', () => {
    const hash = contentHash('');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // Empty string has a known SHA-256 hash
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('handles unicode content', () => {
    const hash = contentHash('こんにちは世界');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles very long content', () => {
    const longContent = 'a'.repeat(100000);
    const hash = contentHash(longContent);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is case-sensitive', () => {
    const hash1 = contentHash('Hello');
    const hash2 = contentHash('hello');
    expect(hash1).not.toBe(hash2);
  });

  it('is whitespace-sensitive', () => {
    const hash1 = contentHash('hello world');
    const hash2 = contentHash('hello  world');
    expect(hash1).not.toBe(hash2);
  });

  it('handles newlines and special characters', () => {
    const hash1 = contentHash('line1\nline2');
    const hash2 = contentHash('line1\rline2');
    expect(hash1).not.toBe(hash2);
  });
});

// ── normaliseEntityName ──

describe('normaliseEntityName', () => {
  it('trims leading and trailing whitespace', () => {
    expect(normaliseEntityName('  hello  ')).toBe('hello');
  });

  it('collapses multiple spaces into single space', () => {
    expect(normaliseEntityName('hello   world')).toBe('hello world');
  });

  it('converts to lowercase', () => {
    expect(normaliseEntityName('Hello World')).toBe('hello world');
  });

  it('handles all transformations together', () => {
    expect(normaliseEntityName('  Hello   World  ')).toBe('hello world');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normaliseEntityName('   ')).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(normaliseEntityName('')).toBe('');
  });

  it('preserves single-word names', () => {
    expect(normaliseEntityName('alice')).toBe('alice');
  });

  it('collapses tabs and mixed whitespace', () => {
    expect(normaliseEntityName('hello\t\tworld')).toBe('hello world');
  });

  it('handles newlines as whitespace', () => {
    expect(normaliseEntityName('hello\nworld')).toBe('hello world');
  });

  it('handles unicode characters', () => {
    expect(normaliseEntityName('  Über  Straße  ')).toBe('über straße');
  });

  it('already-normalised name passes through unchanged', () => {
    const name = 'project alpha';
    expect(normaliseEntityName(name)).toBe(name);
  });
});

// ── truncate ──

describe('truncate', () => {
  it('returns short text unchanged when within limit', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('returns text unchanged when exactly at limit', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('truncates long text and appends ellipsis', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
  });

  it('truncated output length equals maxLength', () => {
    const result = truncate('this is a very long string that should be cut', 20);
    expect(result.length).toBe(20);
    expect(result.endsWith('...')).toBe(true);
  });

  it('handles maxLength of 3 (minimum for ellipsis)', () => {
    expect(truncate('hello', 3)).toBe('...');
  });

  it('handles empty string', () => {
    expect(truncate('', 10)).toBe('');
  });

  it('handles single character within limit', () => {
    expect(truncate('a', 10)).toBe('a');
  });

  it('preserves content when maxLength is very large', () => {
    const text = 'short text';
    expect(truncate(text, 1000)).toBe(text);
  });

  it('handles maxLength of 4 with text longer than 4', () => {
    // Keeps first 1 char + '...'
    expect(truncate('hello', 4)).toBe('h...');
  });
});

// ── nowISO ──

describe('nowISO', () => {
  it('returns a valid ISO 8601 string', () => {
    const iso = nowISO();
    // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
  });

  it('returns a parseable date', () => {
    const iso = nowISO();
    const parsed = new Date(iso);
    expect(parsed.getTime()).not.toBeNaN();
  });

  it('returns a timestamp close to now', () => {
    const before = Date.now();
    const iso = nowISO();
    const after = Date.now();
    const parsed = new Date(iso).getTime();

    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });

  it('returns a UTC timestamp (ends with Z)', () => {
    const iso = nowISO();
    expect(iso.endsWith('Z')).toBe(true);
  });

  it('successive calls produce non-decreasing timestamps', () => {
    const iso1 = nowISO();
    const iso2 = nowISO();
    const time1 = new Date(iso1).getTime();
    const time2 = new Date(iso2).getTime();
    expect(time2).toBeGreaterThanOrEqual(time1);
  });
});
