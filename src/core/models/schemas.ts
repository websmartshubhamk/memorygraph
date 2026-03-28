/**
 * Zod validation schemas for all MCP tool inputs and domain types.
 */

import { z } from 'zod';

// ── Enums ──

export const memoryTypeSchema = z.enum(['episodic', 'semantic', 'procedural']);
export const entityTypeSchema = z.enum(['person', 'organisation', 'project', 'concept', 'location', 'tool', 'event', 'other']);
export const relationTypeSchema = z.enum(['related_to', 'works_on', 'part_of', 'depends_on', 'created_by', 'uses', 'knows', 'similar_to', 'caused_by', 'followed_by']);

// ── Tool Input Schemas ──

export const storeMemorySchema = z.object({
  content: z.string().min(1, 'Content must not be empty').max(50000, 'Content must not exceed 50,000 characters'),
  entities: z.array(z.string().min(1)).min(1, 'At least one entity is required'),
  memoryType: memoryTypeSchema.default('episodic'),
  salience: z.number().min(0).max(1).default(0.5),
  permanent: z.boolean().default(false),
  metadata: z.record(z.unknown()).default({}),
});

export const recallSchema = z.object({
  query: z.string().min(1, 'Query must not be empty').max(10000, 'Query must not exceed 10,000 characters'),
  entityFilter: z.array(z.string().min(1)).optional(),
  memoryType: memoryTypeSchema.optional(),
  limit: z.number().int().min(1).max(100).default(10),
  minSalience: z.number().min(0).max(1).default(0.0),
  includeExpired: z.boolean().default(false),
  clusterExpansion: z.boolean().default(false),
});

export const entityContextSchema = z.object({
  entity: z.string().min(1, 'Entity name must not be empty'),
  limit: z.number().int().min(1).max(100).default(20),
  includeRelations: z.boolean().default(true),
  includeClusters: z.boolean().default(true),
});

export const relateSchema = z.object({
  sourceEntity: z.string().min(1, 'Source entity must not be empty'),
  targetEntity: z.string().min(1, 'Target entity must not be empty'),
  relationType: relationTypeSchema.default('related_to'),
  weight: z.number().min(0).max(1).default(0.5),
  metadata: z.record(z.unknown()).default({}),
});

export const reinforceSchema = z.object({
  memoryId: z.string().uuid('Memory ID must be a valid UUID'),
  amount: z.number().min(0).max(1).default(0.1),
});

export const forgetSchema = z.object({
  memoryId: z.string().uuid('Memory ID must be a valid UUID'),
});

export const entitiesListSchema = z.object({
  query: z.string().optional(),
  entityType: entityTypeSchema.optional(),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().min(0).default(0),
});

export const clustersSchema = z.object({
  refresh: z.boolean().default(false),
});

export const statusSchema = z.object({});

export const maintainSchema = z.object({
  pruneBelow: z.number().min(0).max(1).default(0.01),
  forceClusterRefresh: z.boolean().default(false),
});

// ── Type Exports from Schemas ──

export type StoreMemoryInput = z.infer<typeof storeMemorySchema>;
export type RecallInput = z.infer<typeof recallSchema>;
export type EntityContextInput = z.infer<typeof entityContextSchema>;
export type RelateInput = z.infer<typeof relateSchema>;
export type ReinforceInput = z.infer<typeof reinforceSchema>;
export type ForgetInput = z.infer<typeof forgetSchema>;
export type EntitiesListInput = z.infer<typeof entitiesListSchema>;
export type ClustersInput = z.infer<typeof clustersSchema>;
export type StatusInput = z.infer<typeof statusSchema>;
export type MaintainInput = z.infer<typeof maintainSchema>;
