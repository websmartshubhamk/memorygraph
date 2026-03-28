/**
 * Unit tests for Zod validation schemas.
 *
 * Validates that tool input schemas correctly accept valid data,
 * reject invalid data, and apply sensible defaults.
 */

import { describe, it, expect } from 'vitest';
import {
  storeMemorySchema,
  recallSchema,
  relateSchema,
  reinforceSchema,
  forgetSchema,
  entitiesListSchema,
  entityContextSchema,
  maintainSchema,
  clustersSchema,
  statusSchema,
  memoryTypeSchema,
  entityTypeSchema,
  relationTypeSchema,
} from '../../src/core/models/schemas.js';

// ── storeMemorySchema ──

describe('storeMemorySchema', () => {
  it('accepts valid input with all fields', () => {
    const input = {
      content: 'Some useful memory content',
      entities: ['project-x', 'alice'],
      memoryType: 'semantic',
      salience: 0.8,
      permanent: true,
      metadata: { source: 'test' },
    };
    const result = storeMemorySchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content).toBe('Some useful memory content');
      expect(result.data.entities).toEqual(['project-x', 'alice']);
      expect(result.data.memoryType).toBe('semantic');
      expect(result.data.salience).toBe(0.8);
      expect(result.data.permanent).toBe(true);
      expect(result.data.metadata).toEqual({ source: 'test' });
    }
  });

  it('applies defaults for optional fields', () => {
    const input = {
      content: 'Minimal input',
      entities: ['entity-1'],
    };
    const result = storeMemorySchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.memoryType).toBe('episodic');
      expect(result.data.salience).toBe(0.5);
      expect(result.data.permanent).toBe(false);
      expect(result.data.metadata).toEqual({});
    }
  });

  it('rejects empty content', () => {
    const input = { content: '', entities: ['e1'] };
    const result = storeMemorySchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('empty');
    }
  });

  it('rejects empty entities array', () => {
    const input = { content: 'Valid content', entities: [] };
    const result = storeMemorySchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('entity');
    }
  });

  it('rejects entities with empty strings', () => {
    const input = { content: 'Valid content', entities: [''] };
    const result = storeMemorySchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects content exceeding 50,000 characters', () => {
    const input = {
      content: 'x'.repeat(50001),
      entities: ['e1'],
    };
    const result = storeMemorySchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('accepts content at exactly 50,000 characters', () => {
    const input = {
      content: 'x'.repeat(50000),
      entities: ['e1'],
    };
    const result = storeMemorySchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('rejects salience below 0', () => {
    const input = { content: 'Test', entities: ['e1'], salience: -0.1 };
    const result = storeMemorySchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects salience above 1', () => {
    const input = { content: 'Test', entities: ['e1'], salience: 1.1 };
    const result = storeMemorySchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects invalid memory type', () => {
    const input = { content: 'Test', entities: ['e1'], memoryType: 'imaginary' };
    const result = storeMemorySchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('accepts all valid memory types', () => {
    for (const type of ['episodic', 'semantic', 'procedural']) {
      const result = storeMemorySchema.safeParse({
        content: 'Test',
        entities: ['e1'],
        memoryType: type,
      });
      expect(result.success).toBe(true);
    }
  });
});

// ── recallSchema ──

describe('recallSchema', () => {
  it('accepts valid input with defaults', () => {
    const result = recallSchema.safeParse({ query: 'find something' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.query).toBe('find something');
      expect(result.data.limit).toBe(10);
      expect(result.data.minSalience).toBe(0.0);
      expect(result.data.includeExpired).toBe(false);
      expect(result.data.clusterExpansion).toBe(false);
    }
  });

  it('accepts valid input with all fields specified', () => {
    const input = {
      query: 'search term',
      entityFilter: ['entity-a'],
      memoryType: 'semantic',
      limit: 50,
      minSalience: 0.3,
      includeExpired: true,
      clusterExpansion: true,
    };
    const result = recallSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.entityFilter).toEqual(['entity-a']);
      expect(result.data.limit).toBe(50);
    }
  });

  it('rejects empty query string', () => {
    const result = recallSchema.safeParse({ query: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('empty');
    }
  });

  it('rejects query exceeding 10,000 characters', () => {
    const result = recallSchema.safeParse({ query: 'x'.repeat(10001) });
    expect(result.success).toBe(false);
  });

  it('rejects limit below 1', () => {
    const result = recallSchema.safeParse({ query: 'test', limit: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects limit above 100', () => {
    const result = recallSchema.safeParse({ query: 'test', limit: 101 });
    expect(result.success).toBe(false);
  });

  it('accepts limit at boundaries (1 and 100)', () => {
    const result1 = recallSchema.safeParse({ query: 'test', limit: 1 });
    const result100 = recallSchema.safeParse({ query: 'test', limit: 100 });
    expect(result1.success).toBe(true);
    expect(result100.success).toBe(true);
  });

  it('rejects non-integer limit', () => {
    const result = recallSchema.safeParse({ query: 'test', limit: 5.5 });
    expect(result.success).toBe(false);
  });

  it('rejects minSalience below 0', () => {
    const result = recallSchema.safeParse({ query: 'test', minSalience: -0.1 });
    expect(result.success).toBe(false);
  });

  it('rejects minSalience above 1', () => {
    const result = recallSchema.safeParse({ query: 'test', minSalience: 1.1 });
    expect(result.success).toBe(false);
  });

  it('rejects empty strings in entityFilter', () => {
    const result = recallSchema.safeParse({ query: 'test', entityFilter: [''] });
    expect(result.success).toBe(false);
  });
});

// ── relateSchema ──

describe('relateSchema', () => {
  it('accepts valid input with defaults', () => {
    const result = relateSchema.safeParse({
      sourceEntity: 'alice',
      targetEntity: 'project-x',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relationType).toBe('related_to');
      expect(result.data.weight).toBe(0.5);
      expect(result.data.metadata).toEqual({});
    }
  });

  it('accepts all valid relation types', () => {
    const types = [
      'related_to', 'works_on', 'part_of', 'depends_on', 'created_by',
      'uses', 'knows', 'similar_to', 'caused_by', 'followed_by',
    ];
    for (const relationType of types) {
      const result = relateSchema.safeParse({
        sourceEntity: 'a',
        targetEntity: 'b',
        relationType,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid relation type', () => {
    const result = relateSchema.safeParse({
      sourceEntity: 'a',
      targetEntity: 'b',
      relationType: 'loves',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty source entity', () => {
    const result = relateSchema.safeParse({
      sourceEntity: '',
      targetEntity: 'b',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty target entity', () => {
    const result = relateSchema.safeParse({
      sourceEntity: 'a',
      targetEntity: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects weight below 0', () => {
    const result = relateSchema.safeParse({
      sourceEntity: 'a',
      targetEntity: 'b',
      weight: -0.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects weight above 1', () => {
    const result = relateSchema.safeParse({
      sourceEntity: 'a',
      targetEntity: 'b',
      weight: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

// ── reinforceSchema ──

describe('reinforceSchema', () => {
  it('accepts a valid UUID', () => {
    const result = reinforceSchema.safeParse({
      memoryId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBe(0.1);
    }
  });

  it('accepts a valid UUID with custom amount', () => {
    const result = reinforceSchema.safeParse({
      memoryId: '550e8400-e29b-41d4-a716-446655440000',
      amount: 0.5,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBe(0.5);
    }
  });

  it('rejects an invalid UUID', () => {
    const result = reinforceSchema.safeParse({ memoryId: 'not-a-uuid' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('UUID');
    }
  });

  it('rejects an empty memoryId', () => {
    const result = reinforceSchema.safeParse({ memoryId: '' });
    expect(result.success).toBe(false);
  });

  it('rejects amount below 0', () => {
    const result = reinforceSchema.safeParse({
      memoryId: '550e8400-e29b-41d4-a716-446655440000',
      amount: -0.1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects amount above 1', () => {
    const result = reinforceSchema.safeParse({
      memoryId: '550e8400-e29b-41d4-a716-446655440000',
      amount: 1.1,
    });
    expect(result.success).toBe(false);
  });
});

// ── forgetSchema ──

describe('forgetSchema', () => {
  it('accepts a valid UUID', () => {
    const result = forgetSchema.safeParse({
      memoryId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid UUID', () => {
    const result = forgetSchema.safeParse({ memoryId: 'abc-123' });
    expect(result.success).toBe(false);
  });

  it('rejects missing memoryId', () => {
    const result = forgetSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ── entitiesListSchema ──

describe('entitiesListSchema', () => {
  it('applies defaults for empty input', () => {
    const result = entitiesListSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(0);
      expect(result.data.query).toBeUndefined();
      expect(result.data.entityType).toBeUndefined();
    }
  });

  it('accepts all valid entity types', () => {
    const types = [
      'person', 'organisation', 'project', 'concept',
      'location', 'tool', 'event', 'other',
    ];
    for (const entityType of types) {
      const result = entitiesListSchema.safeParse({ entityType });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid entity type', () => {
    const result = entitiesListSchema.safeParse({ entityType: 'animal' });
    expect(result.success).toBe(false);
  });

  it('rejects limit below 1', () => {
    const result = entitiesListSchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects limit above 500', () => {
    const result = entitiesListSchema.safeParse({ limit: 501 });
    expect(result.success).toBe(false);
  });

  it('rejects negative offset', () => {
    const result = entitiesListSchema.safeParse({ offset: -1 });
    expect(result.success).toBe(false);
  });

  it('accepts offset of 0', () => {
    const result = entitiesListSchema.safeParse({ offset: 0 });
    expect(result.success).toBe(true);
  });
});

// ── entityContextSchema ──

describe('entityContextSchema', () => {
  it('accepts valid input with defaults', () => {
    const result = entityContextSchema.safeParse({ entity: 'alice' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
      expect(result.data.includeRelations).toBe(true);
      expect(result.data.includeClusters).toBe(true);
    }
  });

  it('rejects empty entity name', () => {
    const result = entityContextSchema.safeParse({ entity: '' });
    expect(result.success).toBe(false);
  });
});

// ── maintainSchema ──

describe('maintainSchema', () => {
  it('applies defaults for empty input', () => {
    const result = maintainSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pruneBelow).toBe(0.01);
      expect(result.data.forceClusterRefresh).toBe(false);
    }
  });

  it('rejects pruneBelow above 1', () => {
    const result = maintainSchema.safeParse({ pruneBelow: 1.5 });
    expect(result.success).toBe(false);
  });
});

// ── clustersSchema ──

describe('clustersSchema', () => {
  it('defaults refresh to false', () => {
    const result = clustersSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.refresh).toBe(false);
    }
  });
});

// ── statusSchema ──

describe('statusSchema', () => {
  it('accepts empty object', () => {
    const result = statusSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

// ── Enum schemas ──

describe('memoryTypeSchema', () => {
  it('accepts valid values', () => {
    for (const t of ['episodic', 'semantic', 'procedural']) {
      expect(memoryTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it('rejects invalid values', () => {
    expect(memoryTypeSchema.safeParse('declarative').success).toBe(false);
    expect(memoryTypeSchema.safeParse('').success).toBe(false);
  });
});

describe('entityTypeSchema', () => {
  it('accepts all valid entity types including organisation (UK spelling)', () => {
    const result = entityTypeSchema.safeParse('organisation');
    expect(result.success).toBe(true);
  });

  it('rejects US spelling "organization"', () => {
    const result = entityTypeSchema.safeParse('organization');
    expect(result.success).toBe(false);
  });
});

describe('relationTypeSchema', () => {
  it('accepts all valid relation types', () => {
    const types = [
      'related_to', 'works_on', 'part_of', 'depends_on', 'created_by',
      'uses', 'knows', 'similar_to', 'caused_by', 'followed_by',
    ];
    for (const t of types) {
      expect(relationTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it('rejects unknown relation type', () => {
    expect(relationTypeSchema.safeParse('loves').success).toBe(false);
  });
});
