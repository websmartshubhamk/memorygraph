/**
 * Recall engine — semantic search with salience-weighted ranking.
 *
 * Embeds the query, searches for similar memory vectors, filters by entity
 * and memory type constraints, then ranks by a combined score of vector
 * similarity (60%) and salience (40%).
 */

import type { Entity, ScoredMemory, RecallResult } from '../models/types.js';
import type { RecallInput } from '../models/schemas.js';
import type { MemoryStore, EntityMemoryStore, EntityStore, VectorStore } from '../interfaces/stores.js';
import type { EmbeddingProvider, SalienceEngine } from '../interfaces/services.js';
import type { Logger } from '../../utils/logger.js';
import { normaliseEntityName } from '../../utils/text.js';

/** Weights for the combined scoring formula. */
const SIMILARITY_WEIGHT = 0.6;
const SALIENCE_WEIGHT = 0.4;

/** Candidate oversampling multiplier to ensure enough results after filtering. */
const CANDIDATE_MULTIPLIER = 3;

export class RecallEngineImpl {
  constructor(
    private memoryStore: MemoryStore,
    private entityMemoryStore: EntityMemoryStore,
    private entityStore: EntityStore,
    private vectorStore: VectorStore,
    private embeddingProvider: EmbeddingProvider,
    private salienceEngine: SalienceEngine,
    private logger: Logger,
  ) {}

  /**
   * Perform semantic recall against the memory graph.
   *
   * Algorithm:
   *   1. Embed the query text.
   *   2. Search memory_vectors for similar embeddings (limit * 3 candidates).
   *   3. For each candidate: fetch memory, skip if deleted or below minSalience.
   *   4. If entityFilter: check entity_memories for matching entity names.
   *   5. If memoryType: filter by memory type.
   *   6. Calculate combined score: (similarity * 0.6) + (salience * 0.4).
   *   7. Resolve entities for each surviving memory.
   *   8. Sort by combinedScore descending, take limit results.
   *   9. Return RecallResult with timing information.
   */
  async recall(input: RecallInput): Promise<RecallResult> {
    const overallStart = performance.now();

    // 1. Embed the query
    const embedStart = performance.now();
    const queryEmbedding = await this.embeddingProvider.embed(input.query);
    const queryEmbeddingTime = performance.now() - embedStart;

    this.logger.debug(
      { query: input.query, embeddingTimeMs: queryEmbeddingTime.toFixed(2) },
      'Query embedded',
    );

    // 2. Search for candidate vectors
    const searchStart = performance.now();
    const candidateLimit = input.limit * CANDIDATE_MULTIPLIER;
    const candidates = this.vectorStore.search('memory_vectors', queryEmbedding, candidateLimit);

    this.logger.debug(
      { candidateCount: candidates.length, candidateLimit },
      'Vector search complete',
    );

    // Pre-compute normalised entity filter names for efficient comparison
    const normalisedEntityFilter = input.entityFilter
      ? input.entityFilter.map(normaliseEntityName)
      : null;

    // 3-6. Filter and score candidates
    const scored: ScoredMemory[] = [];

    for (const candidate of candidates) {
      // Fetch the full memory record
      const memory = this.memoryStore.getById(candidate.id);

      if (!memory) {
        this.logger.debug({ memoryId: candidate.id }, 'Memory not found for vector candidate; skipping');
        continue;
      }

      // Skip deleted memories
      if (memory.deleted) {
        continue;
      }

      // Calculate current salience
      const salience = this.salienceEngine.calculate(memory);

      // Skip below minimum salience threshold
      if (salience < input.minSalience) {
        continue;
      }

      // 4. Entity filter: memory must be linked to at least one matching entity
      if (normalisedEntityFilter !== null) {
        const entityMemories = this.entityMemoryStore.getEntitiesForMemory(memory.id);
        const matchesFilter = entityMemories.some((em) => {
          const entity = this.entityStore.getById(em.entityId);
          if (!entity) return false;

          const normalisedName = normaliseEntityName(entity.name);
          if (normalisedEntityFilter.includes(normalisedName)) return true;

          // Also check aliases
          return entity.aliases.some(
            (alias) => normalisedEntityFilter.includes(normaliseEntityName(alias)),
          );
        });

        if (!matchesFilter) {
          continue;
        }
      }

      // 5. Memory type filter
      if (input.memoryType && memory.memoryType !== input.memoryType) {
        continue;
      }

      // 6. Calculate combined score
      // Vector distance is a distance metric (lower = more similar).
      // Convert to similarity: 1 - distance (clamped to [0, 1]).
      const similarity = Math.max(0, Math.min(1, 1 - candidate.distance));
      const combinedScore = (similarity * SIMILARITY_WEIGHT) + (salience * SALIENCE_WEIGHT);

      // 7. Resolve entities for this memory
      const entityMemories = this.entityMemoryStore.getEntitiesForMemory(memory.id);
      const entities: Entity[] = [];
      for (const em of entityMemories) {
        const entity = this.entityStore.getById(em.entityId);
        if (entity) {
          entities.push(entity);
        }
      }

      scored.push({
        memory,
        entities,
        similarity,
        salience,
        combinedScore,
      });
    }

    // 8. Sort by combined score descending, take limit
    scored.sort((a, b) => b.combinedScore - a.combinedScore);
    const results = scored.slice(0, input.limit);

    const searchTime = performance.now() - searchStart;

    this.logger.info(
      {
        query: input.query,
        totalCandidates: candidates.length,
        afterFiltering: scored.length,
        returned: results.length,
        queryEmbeddingTimeMs: queryEmbeddingTime.toFixed(2),
        searchTimeMs: searchTime.toFixed(2),
        totalTimeMs: (performance.now() - overallStart).toFixed(2),
      },
      'Recall complete',
    );

    // 9. Return result with timing
    return {
      memories: results,
      totalFound: scored.length,
      queryEmbeddingTime,
      searchTime,
    };
  }
}
