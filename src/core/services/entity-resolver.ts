/**
 * Entity Resolver — resolves entity names to Entity records.
 *
 * Resolution algorithm (ordered by priority):
 * 1. Exact name match (case-insensitive)
 * 2. Alias match
 * 3. Vector similarity > 0.85 → same entity (return existing)
 * 4. Vector similarity 0.7–0.85 → potential match, create new entity
 * 5. Vector similarity < 0.7 → definitely new entity
 */

import { v4 as uuidv4 } from 'uuid';

import type { Entity, EntityType, Embedding } from '../models/types.js';
import type { EntityStore, VectorStore } from '../interfaces/stores.js';
import type { EmbeddingProvider, EntityResolver } from '../interfaces/services.js';
import type { Logger } from '../../utils/logger.js';
import { nowISO, normaliseEntityName } from '../../utils/text.js';

/** Vector table name for entity embeddings. */
const ENTITY_VECTOR_TABLE = 'entity_vectors';

/** Default similarity threshold for findSimilar. */
const DEFAULT_SIMILARITY_THRESHOLD = 0.7;

/** Threshold above which a vector match is considered the same entity. */
const SAME_ENTITY_THRESHOLD = 0.85;

/** Maximum candidates to retrieve from vector search. */
const VECTOR_SEARCH_LIMIT = 10;

/**
 * Convert cosine distance (from sqlite-vec) to similarity score.
 * sqlite-vec returns distance where 0 = identical, 2 = opposite for cosine.
 * Similarity = 1 - (distance / 2) for cosine distance in [0, 2].
 */
function distanceToSimilarity(distance: number): number {
  return 1 - distance / 2;
}

export class EntityResolverImpl implements EntityResolver {
  constructor(
    private entityStore: EntityStore,
    private vectorStore: VectorStore,
    private embeddingProvider: EmbeddingProvider,
    private logger: Logger,
  ) {}

  /**
   * Resolve an entity name to an Entity record.
   *
   * Uses a multi-step resolution strategy:
   * 1. Exact name match (case-insensitive)
   * 2. Alias match
   * 3. Vector similarity search
   *    - > 0.85 similarity → return existing entity
   *    - 0.7–0.85 → create new entity (potential match, not confident enough)
   *    - < 0.7 → create new entity (definitely new)
   */
  async resolve(name: string, entityType?: string): Promise<Entity> {
    const normalisedName = normaliseEntityName(name);

    if (!normalisedName) {
      throw new Error('Entity name cannot be empty');
    }

    // Step 1: Exact name match (case-insensitive)
    const exactMatch = this.entityStore.getByName(normalisedName);
    if (exactMatch) {
      this.logger.debug({ entityId: exactMatch.id, name: normalisedName }, 'Entity resolved via exact name match');
      return exactMatch;
    }

    // Step 2: Alias match
    const aliasMatch = this.entityStore.getByAlias(normalisedName);
    if (aliasMatch) {
      this.logger.debug({ entityId: aliasMatch.id, name: normalisedName }, 'Entity resolved via alias match');
      return aliasMatch;
    }

    // Step 3: Vector similarity search
    const embedding = await this.embeddingProvider.embed(normalisedName);
    const vectorResults = this.vectorStore.search(ENTITY_VECTOR_TABLE, embedding, VECTOR_SEARCH_LIMIT);

    if (vectorResults.length > 0) {
      const bestMatch = vectorResults[0];
      const similarity = distanceToSimilarity(bestMatch.distance);

      if (similarity > SAME_ENTITY_THRESHOLD) {
        // High confidence — treat as same entity
        const existingEntity = this.entityStore.getById(bestMatch.id);
        if (existingEntity) {
          this.logger.debug(
            { entityId: existingEntity.id, name: normalisedName, similarity },
            'Entity resolved via vector similarity (same entity)',
          );
          return existingEntity;
        }
        // Entity record missing despite vector existing — fall through to creation
        this.logger.warn(
          { vectorId: bestMatch.id, name: normalisedName },
          'Vector record exists but entity not found in store; creating new entity',
        );
      } else if (similarity >= DEFAULT_SIMILARITY_THRESHOLD) {
        // Potential match but not confident enough — create new entity
        this.logger.debug(
          { name: normalisedName, similarity, bestMatchId: bestMatch.id },
          'Potential entity match found but below confidence threshold; creating new entity',
        );
      } else {
        this.logger.debug(
          { name: normalisedName, similarity },
          'No sufficiently similar entity found; creating new entity',
        );
      }
    } else {
      this.logger.debug({ name: normalisedName }, 'No vector matches found; creating new entity');
    }

    // Create new entity
    return this.createEntity(normalisedName, entityType, embedding);
  }

  /**
   * Find entities with names similar to the given name.
   * Uses vector similarity search and returns all entities above the threshold.
   *
   * @param name - The name to search for
   * @param threshold - Minimum similarity score (default: 0.7)
   * @returns Entities sorted by similarity (highest first)
   */
  async findSimilar(name: string, threshold: number = DEFAULT_SIMILARITY_THRESHOLD): Promise<Entity[]> {
    const normalisedName = normaliseEntityName(name);

    if (!normalisedName) {
      return [];
    }

    const embedding = await this.embeddingProvider.embed(normalisedName);
    const vectorResults = this.vectorStore.search(ENTITY_VECTOR_TABLE, embedding, VECTOR_SEARCH_LIMIT);

    const entities: Entity[] = [];

    for (const result of vectorResults) {
      const similarity = distanceToSimilarity(result.distance);

      if (similarity < threshold) {
        // Results are ordered by distance (ascending), so once we drop below
        // threshold, all subsequent results will also be below.
        break;
      }

      const entity = this.entityStore.getById(result.id);
      if (entity) {
        entities.push(entity);
      } else {
        this.logger.warn(
          { vectorId: result.id },
          'Vector record exists but entity not found in store; skipping',
        );
      }
    }

    return entities;
  }

  /**
   * Create a new entity, persist it, and store its embedding vector.
   */
  private createEntity(
    normalisedName: string,
    entityType: string | undefined,
    embedding: Embedding,
  ): Entity {
    const resolvedType = this.resolveEntityType(entityType);
    const now = nowISO();
    const entity: Entity = {
      id: uuidv4(),
      name: normalisedName,
      entityType: resolvedType,
      aliases: [],
      description: '',
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };

    this.entityStore.create(entity);
    this.vectorStore.upsert(ENTITY_VECTOR_TABLE, entity.id, embedding);

    this.logger.info(
      { entityId: entity.id, name: normalisedName, entityType: resolvedType },
      'Created new entity',
    );

    return entity;
  }

  /**
   * Validate and resolve the entity type string to a typed EntityType.
   * Defaults to 'other' if not provided or invalid.
   */
  private resolveEntityType(entityType: string | undefined): EntityType {
    const validTypes: ReadonlySet<string> = new Set<string>([
      'person',
      'organisation',
      'project',
      'concept',
      'location',
      'tool',
      'event',
      'other',
    ]);

    if (!entityType) {
      return 'other';
    }

    const normalised = entityType.trim().toLowerCase();
    if (validTypes.has(normalised)) {
      return normalised as EntityType;
    }

    this.logger.warn(
      { providedType: entityType },
      'Unknown entity type provided; defaulting to "other"',
    );
    return 'other';
  }
}
