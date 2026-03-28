/**
 * Unit tests for SalienceEngineImpl.
 *
 * Validates the salience formula, including permanent memory handling,
 * decay, recency/frequency/reinforcement boosts, clamping, and projection.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SalienceEngineImpl } from '../../src/core/services/salience-engine.js';
import type { Memory } from '../../src/core/models/types.js';
import type { Logger } from '../../src/utils/logger.js';

// ── Helpers ──

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'test-memory-id',
    content: 'test content',
    memoryType: 'episodic',
    initialSalience: 0.5,
    currentSalience: 0.5,
    decayRate: 0.01,
    permanent: false,
    accessCount: 0,
    reinforcementCount: 0,
    lastAccessedAt: new Date().toISOString(),
    metadata: {},
    contentHash: 'abc123',
    deleted: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create an ISO timestamp representing `days` days in the past.
 */
function daysAgo(days: number): string {
  const d = new Date();
  d.setTime(d.getTime() - days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

// ── Tests ──

describe('SalienceEngineImpl', () => {
  let engine: SalienceEngineImpl;
  let logger: Logger;

  beforeEach(() => {
    logger = makeLogger();
    engine = new SalienceEngineImpl(logger);
  });

  // ── Permanent memories ──

  describe('permanent memories', () => {
    it('returns max(initialSalience, 0.8) when permanent and salience < 0.8', () => {
      const memory = makeMemory({ permanent: true, initialSalience: 0.3 });
      expect(engine.calculate(memory)).toBe(0.8);
    });

    it('returns initialSalience when permanent and salience > 0.8', () => {
      const memory = makeMemory({ permanent: true, initialSalience: 0.95 });
      expect(engine.calculate(memory)).toBe(0.95);
    });

    it('returns exactly 0.8 when permanent and salience equals 0.8', () => {
      const memory = makeMemory({ permanent: true, initialSalience: 0.8 });
      expect(engine.calculate(memory)).toBe(0.8);
    });

    it('ignores decay, access count, and reinforcement for permanent memories', () => {
      const memory = makeMemory({
        permanent: true,
        initialSalience: 0.5,
        decayRate: 1.0,
        accessCount: 0,
        reinforcementCount: 0,
        createdAt: daysAgo(365),
        lastAccessedAt: daysAgo(365),
      });
      // Despite extreme decay and zero boosts, permanent floor applies
      expect(engine.calculate(memory)).toBe(0.8);
    });
  });

  // ── Fresh memory (just created, no access) ──

  describe('fresh memory with no access history', () => {
    it('returns approximately initial salience for a brand-new memory', () => {
      const memory = makeMemory({
        initialSalience: 0.5,
        decayRate: 0.01,
        accessCount: 0,
        reinforcementCount: 0,
      });
      const score = engine.calculate(memory);
      // base=0.5, decay~0 (just created), recency~0.1 (just accessed), frequency=0, reinforcement=0
      // Score should be ~0.6 (0.5 + 0.1)
      expect(score).toBeGreaterThanOrEqual(0.55);
      expect(score).toBeLessThanOrEqual(0.65);
    });

    it('returns higher score for higher initial salience', () => {
      const lowSalience = makeMemory({ initialSalience: 0.3 });
      const highSalience = makeMemory({ initialSalience: 0.9 });

      expect(engine.calculate(highSalience)).toBeGreaterThan(engine.calculate(lowSalience));
    });
  });

  // ── Decay ──

  describe('salience decays over time', () => {
    it('produces lower salience for older memories', () => {
      const recentMemory = makeMemory({
        initialSalience: 0.5,
        decayRate: 0.01,
        createdAt: daysAgo(1),
        lastAccessedAt: daysAgo(1),
      });
      const oldMemory = makeMemory({
        initialSalience: 0.5,
        decayRate: 0.01,
        createdAt: daysAgo(30),
        lastAccessedAt: daysAgo(30),
      });

      expect(engine.calculate(recentMemory)).toBeGreaterThan(engine.calculate(oldMemory));
    });

    it('higher decay rate causes faster salience drop', () => {
      const slowDecay = makeMemory({
        initialSalience: 0.5,
        decayRate: 0.001,
        createdAt: daysAgo(10),
        lastAccessedAt: daysAgo(10),
      });
      const fastDecay = makeMemory({
        initialSalience: 0.5,
        decayRate: 0.1,
        createdAt: daysAgo(10),
        lastAccessedAt: daysAgo(10),
      });

      expect(engine.calculate(slowDecay)).toBeGreaterThan(engine.calculate(fastDecay));
    });

    it('zero decay rate means no decay penalty', () => {
      const memory = makeMemory({
        initialSalience: 0.5,
        decayRate: 0,
        createdAt: daysAgo(100),
        lastAccessedAt: new Date().toISOString(),
      });
      const score = engine.calculate(memory);
      // base=0.5, decay=0, recency~0.1, frequency=0, reinforcement=0 => ~0.6
      expect(score).toBeGreaterThanOrEqual(0.55);
      expect(score).toBeLessThanOrEqual(0.65);
    });
  });

  // ── Recency boost ──

  describe('recency boost', () => {
    it('recently accessed memory scores higher than stale memory', () => {
      const recentAccess = makeMemory({
        initialSalience: 0.5,
        createdAt: daysAgo(10),
        lastAccessedAt: new Date().toISOString(),
      });
      const staleAccess = makeMemory({
        initialSalience: 0.5,
        createdAt: daysAgo(10),
        lastAccessedAt: daysAgo(10),
      });

      expect(engine.calculate(recentAccess)).toBeGreaterThan(engine.calculate(staleAccess));
    });

    it('recency boost is approximately 0.1 for just-accessed memory', () => {
      // When daysSinceAccess ≈ 0: recencyBoost = 0.1 * (1 / (1 + 0)) = 0.1
      const memory = makeMemory({
        initialSalience: 0.5,
        decayRate: 0,
        accessCount: 0,
        reinforcementCount: 0,
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      });
      const score = engine.calculate(memory);
      // base=0.5 + recency≈0.1 = 0.6
      expect(score).toBeCloseTo(0.6, 1);
    });

    it('recency boost diminishes with time since last access', () => {
      // daysSinceAccess=10: recencyBoost = 0.1 * (1 / 11) ≈ 0.009
      const memory = makeMemory({
        initialSalience: 0.5,
        decayRate: 0,
        accessCount: 0,
        reinforcementCount: 0,
        createdAt: new Date().toISOString(),
        lastAccessedAt: daysAgo(10),
      });
      const score = engine.calculate(memory);
      // base=0.5 + recency≈0.009 ≈ 0.509
      expect(score).toBeCloseTo(0.509, 1);
    });
  });

  // ── Frequency boost ──

  describe('frequency boost', () => {
    it('more accesses produce a higher score', () => {
      const fewAccesses = makeMemory({
        initialSalience: 0.5,
        accessCount: 1,
        createdAt: daysAgo(5),
        lastAccessedAt: daysAgo(5),
      });
      const manyAccesses = makeMemory({
        initialSalience: 0.5,
        accessCount: 100,
        createdAt: daysAgo(5),
        lastAccessedAt: daysAgo(5),
      });

      expect(engine.calculate(manyAccesses)).toBeGreaterThan(engine.calculate(fewAccesses));
    });

    it('frequency boost follows logarithmic curve (diminishing returns)', () => {
      const base = makeMemory({
        initialSalience: 0.5,
        decayRate: 0,
        reinforcementCount: 0,
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      });

      const score0 = engine.calculate({ ...base, accessCount: 0 });
      const score10 = engine.calculate({ ...base, accessCount: 10 });
      const score100 = engine.calculate({ ...base, accessCount: 100 });
      const score1000 = engine.calculate({ ...base, accessCount: 1000 });

      // Each step grows smaller due to log2
      const diff1 = score10 - score0;
      const diff2 = score100 - score10;
      const diff3 = score1000 - score100;

      expect(diff1).toBeGreaterThan(diff2);
      expect(diff2).toBeGreaterThan(diff3);
    });

    it('zero access count gives zero frequency boost', () => {
      // frequencyBoost = 0.05 * log2(1 + 0) = 0.05 * 0 = 0
      const memory = makeMemory({
        initialSalience: 0.5,
        decayRate: 0,
        accessCount: 0,
        reinforcementCount: 0,
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      });
      const score = engine.calculate(memory);
      // 0.5 + 0 + ~0.1 + 0 + 0 = ~0.6
      expect(score).toBeCloseTo(0.6, 1);
    });
  });

  // ── Reinforcement boost ──

  describe('reinforcement boost', () => {
    it('reinforced memories score higher than unreinforced', () => {
      const unreinforced = makeMemory({
        initialSalience: 0.5,
        reinforcementCount: 0,
        createdAt: daysAgo(5),
        lastAccessedAt: daysAgo(5),
      });
      const reinforced = makeMemory({
        initialSalience: 0.5,
        reinforcementCount: 2,
        createdAt: daysAgo(5),
        lastAccessedAt: daysAgo(5),
      });

      expect(engine.calculate(reinforced)).toBeGreaterThan(engine.calculate(unreinforced));
    });

    it('each reinforcement adds 0.15 to the boost', () => {
      const base = makeMemory({
        initialSalience: 0.5,
        decayRate: 0,
        accessCount: 0,
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      });

      const score0 = engine.calculate({ ...base, reinforcementCount: 0 });
      const score1 = engine.calculate({ ...base, reinforcementCount: 1 });
      const score2 = engine.calculate({ ...base, reinforcementCount: 2 });

      expect(score1 - score0).toBeCloseTo(0.15, 2);
      expect(score2 - score1).toBeCloseTo(0.15, 2);
    });

    it('reinforcement boost is capped at 0.6', () => {
      const base = makeMemory({
        initialSalience: 0.3,
        decayRate: 0,
        accessCount: 0,
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      });

      // 4 reinforcements = 0.6 (cap), 10 reinforcements should also = 0.6
      const score4 = engine.calculate({ ...base, reinforcementCount: 4 });
      const score10 = engine.calculate({ ...base, reinforcementCount: 10 });

      expect(score4).toEqual(score10);
    });

    it('reinforcement boost with count=4 equals min(0.6, 0.6)', () => {
      // 0.15 * 4 = 0.6 => min(0.6, 0.6) = 0.6
      const memory = makeMemory({
        initialSalience: 0.3,
        decayRate: 0,
        accessCount: 0,
        reinforcementCount: 4,
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      });
      const score = engine.calculate(memory);
      // base=0.3 + decay=0 + recency~0.1 + frequency=0 + reinforcement=0.6 = ~1.0
      expect(score).toEqual(1.0);
    });
  });

  // ── Clamping ──

  describe('score clamping', () => {
    it('score never exceeds 1.0 even with all boosts maxed', () => {
      const memory = makeMemory({
        initialSalience: 1.0,
        decayRate: 0,
        accessCount: 10000,
        reinforcementCount: 100,
        lastAccessedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
      expect(engine.calculate(memory)).toBe(1.0);
    });

    it('score never drops below 0.0 even with extreme decay', () => {
      const memory = makeMemory({
        initialSalience: 0.1,
        decayRate: 1.0,
        accessCount: 0,
        reinforcementCount: 0,
        createdAt: daysAgo(365),
        lastAccessedAt: daysAgo(365),
      });
      expect(engine.calculate(memory)).toBe(0.0);
    });

    it('very small positive result is preserved (not floored to 0)', () => {
      const memory = makeMemory({
        initialSalience: 0.01,
        decayRate: 0,
        accessCount: 0,
        reinforcementCount: 0,
        createdAt: new Date().toISOString(),
        lastAccessedAt: daysAgo(100),
      });
      const score = engine.calculate(memory);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(0.1);
    });
  });

  // ── decay() projection ──

  describe('decay() — forward projection', () => {
    it('projects lower salience with more days', () => {
      const memory = makeMemory({
        initialSalience: 0.5,
        decayRate: 0.01,
      });
      const score0 = engine.decay(memory, 0);
      const score10 = engine.decay(memory, 10);
      const score100 = engine.decay(memory, 100);

      expect(score0).toBeGreaterThan(score10);
      expect(score10).toBeGreaterThan(score100);
    });

    it('zero additional days returns the same as calculate()', () => {
      const memory = makeMemory({
        initialSalience: 0.5,
        decayRate: 0.01,
      });
      const calcScore = engine.calculate(memory);
      const decayScore = engine.decay(memory, 0);

      expect(decayScore).toBeCloseTo(calcScore, 5);
    });

    it('negative days are treated as zero with a warning', () => {
      const memory = makeMemory({ initialSalience: 0.5 });
      const score = engine.decay(memory, -5);
      const scoreZero = engine.decay(memory, 0);

      expect(score).toBeCloseTo(scoreZero, 5);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('permanent memories ignore decay projection', () => {
      const memory = makeMemory({
        permanent: true,
        initialSalience: 0.5,
      });
      expect(engine.decay(memory, 0)).toBe(0.8);
      expect(engine.decay(memory, 100)).toBe(0.8);
      expect(engine.decay(memory, 1000)).toBe(0.8);
    });
  });

  // ── reinforce() ──

  describe('reinforce() — salience after reinforcement', () => {
    it('increases salience compared to calculate()', () => {
      const memory = makeMemory({
        initialSalience: 0.5,
        reinforcementCount: 0,
        createdAt: daysAgo(5),
        lastAccessedAt: daysAgo(5),
      });
      const calcScore = engine.calculate(memory);
      const reinforcedScore = engine.reinforce(memory, 0.1);

      expect(reinforcedScore).toBeGreaterThan(calcScore);
    });

    it('resets recency (daysSinceAccess=0) on reinforcement', () => {
      const memory = makeMemory({
        initialSalience: 0.5,
        decayRate: 0,
        accessCount: 0,
        reinforcementCount: 0,
        createdAt: new Date().toISOString(),
        lastAccessedAt: daysAgo(30),
      });
      const reinforcedScore = engine.reinforce(memory, 0.1);
      // After reinforce: daysSinceAccess=0, so recency=0.1, plus reinforcement=0.15
      // base=0.5 + 0.1 + 0 + 0.15 = 0.75
      expect(reinforcedScore).toBeCloseTo(0.75, 1);
    });

    it('negative amount treated as zero with warning', () => {
      const memory = makeMemory({
        initialSalience: 0.5,
        reinforcementCount: 0,
      });
      engine.reinforce(memory, -1);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('permanent memories return floor even when reinforced', () => {
      const memory = makeMemory({
        permanent: true,
        initialSalience: 0.5,
        reinforcementCount: 0,
      });
      expect(engine.reinforce(memory, 0.1)).toBe(0.8);
    });

    it('increments reinforcement count by 1 in calculation', () => {
      const memory = makeMemory({
        initialSalience: 0.5,
        decayRate: 0,
        accessCount: 0,
        reinforcementCount: 2,
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      });
      // calculate uses reinforcementCount=2: boost = 0.15*2 = 0.3
      const calcScore = engine.calculate(memory);
      // reinforce uses reinforcementCount=3: boost = 0.15*3 = 0.45
      const reinforcedScore = engine.reinforce(memory, 0.1);
      // Difference should be ~0.15 (one additional reinforcement step)
      expect(reinforcedScore - calcScore).toBeCloseTo(0.15, 1);
    });
  });

  // ── Edge cases ──

  describe('edge cases', () => {
    it('handles zero initial salience', () => {
      const memory = makeMemory({
        initialSalience: 0,
        decayRate: 0,
        accessCount: 0,
        reinforcementCount: 0,
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      });
      const score = engine.calculate(memory);
      // base=0, recency~0.1, all else 0 => ~0.1
      expect(score).toBeCloseTo(0.1, 1);
    });

    it('handles maximum initial salience of 1.0', () => {
      const memory = makeMemory({
        initialSalience: 1.0,
        decayRate: 0,
        accessCount: 0,
        reinforcementCount: 0,
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      });
      const score = engine.calculate(memory);
      // base=1.0 + recency~0.1 => clamped to 1.0
      expect(score).toBe(1.0);
    });

    it('handles extremely old memory (year-old)', () => {
      const memory = makeMemory({
        initialSalience: 0.5,
        decayRate: 0.01,
        accessCount: 0,
        reinforcementCount: 0,
        createdAt: daysAgo(365),
        lastAccessedAt: daysAgo(365),
      });
      const score = engine.calculate(memory);
      // decay = 0.5 * 0.01 * 365 = 1.825 => very negative, clamped to 0
      expect(score).toBe(0.0);
    });

    it('memory created in the future (clock skew) treats age as zero', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);

      const memory = makeMemory({
        initialSalience: 0.5,
        decayRate: 0.01,
        createdAt: futureDate.toISOString(),
        lastAccessedAt: futureDate.toISOString(),
      });
      const score = engine.calculate(memory);
      // daysBetween returns 0 for negative diff, so no decay and full recency
      expect(score).toBeCloseTo(0.6, 1);
    });
  });
});
