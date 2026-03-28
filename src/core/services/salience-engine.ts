/**
 * Salience engine — calculates, decays, and reinforces memory salience scores.
 *
 * Salience determines how "important" a memory is and whether it should surface
 * during recall. Permanent memories are protected with a minimum floor of 0.8.
 */

import type { Memory } from '../models/types.js';
import type { SalienceEngine } from '../interfaces/services.js';
import type { Logger } from '../../utils/logger.js';

/**
 * Clamp a value between min and max bounds (inclusive).
 */
function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Calculate the number of days between two ISO timestamps.
 * Returns 0 if the result would be negative (clock skew protection).
 */
function daysBetween(from: string, to: Date): number {
  const fromMs = new Date(from).getTime();
  const toMs = to.getTime();
  const diffMs = toMs - fromMs;
  if (diffMs <= 0) return 0;
  return diffMs / (1000 * 60 * 60 * 24);
}

export class SalienceEngineImpl implements SalienceEngine {
  constructor(private logger: Logger) {}

  /**
   * Calculate the current salience score for a memory.
   *
   * Formula:
   *   If permanent: return max(initialSalience, 0.8)
   *   base = initialSalience
   *   decay = base * decayRate * ageDays
   *   recencyBoost = 0.1 * (1 / (1 + daysSinceAccess))
   *   frequencyBoost = 0.05 * log2(1 + accessCount)
   *   reinforcementBoost = min(0.15 * reinforcementCount, 0.6)
   *   score = clamp(base - decay + recencyBoost + frequencyBoost + reinforcementBoost, 0, 1)
   */
  calculate(memory: Memory): number {
    if (memory.permanent) {
      return Math.max(memory.initialSalience, 0.8);
    }

    const now = new Date();
    const ageDays = daysBetween(memory.createdAt, now);
    const daysSinceAccess = daysBetween(memory.lastAccessedAt, now);

    return this.computeScore(memory, ageDays, daysSinceAccess, memory.reinforcementCount);
  }

  /**
   * Calculate what the salience would be after an additional number of decay days.
   *
   * This projects the salience forward in time without mutating the memory,
   * useful for maintenance planning and pruning decisions.
   */
  decay(memory: Memory, days: number): number {
    if (days < 0) {
      this.logger.warn({ memoryId: memory.id, days }, 'Negative decay days requested; treating as zero');
      days = 0;
    }

    if (memory.permanent) {
      return Math.max(memory.initialSalience, 0.8);
    }

    const now = new Date();
    const ageDays = daysBetween(memory.createdAt, now) + days;
    const daysSinceAccess = daysBetween(memory.lastAccessedAt, now) + days;

    return this.computeScore(memory, ageDays, daysSinceAccess, memory.reinforcementCount);
  }

  /**
   * Calculate the new salience after reinforcement.
   *
   * Simulates incrementing reinforcementCount by 1 and recalculating.
   * The `amount` parameter is reserved for future weighted reinforcement
   * but currently the formula uses discrete reinforcement counts.
   */
  reinforce(memory: Memory, amount: number): number {
    if (amount < 0) {
      this.logger.warn({ memoryId: memory.id, amount }, 'Negative reinforcement amount; treating as zero');
      amount = 0;
    }

    if (memory.permanent) {
      return Math.max(memory.initialSalience, 0.8);
    }

    const now = new Date();
    const ageDays = daysBetween(memory.createdAt, now);
    // Reinforcement implies recent access, so daysSinceAccess resets to 0
    const daysSinceAccess = 0;
    const newReinforcementCount = memory.reinforcementCount + 1;

    return this.computeScore(memory, ageDays, daysSinceAccess, newReinforcementCount);
  }

  /**
   * Internal scoring computation shared by calculate, decay, and reinforce.
   */
  private computeScore(
    memory: Memory,
    ageDays: number,
    daysSinceAccess: number,
    reinforcementCount: number,
  ): number {
    const base = memory.initialSalience;
    const decayPenalty = base * memory.decayRate * ageDays;
    const recencyBoost = 0.1 * (1 / (1 + daysSinceAccess));
    const frequencyBoost = 0.05 * Math.log2(1 + memory.accessCount);
    const reinforcementBoost = Math.min(0.15 * reinforcementCount, 0.6);

    const score = base - decayPenalty + recencyBoost + frequencyBoost + reinforcementBoost;

    this.logger.debug(
      {
        memoryId: memory.id,
        base,
        decayPenalty,
        recencyBoost,
        frequencyBoost,
        reinforcementBoost,
        rawScore: score,
        clampedScore: clamp(score, 0, 1),
      },
      'Salience computation',
    );

    return clamp(score, 0, 1);
  }
}
