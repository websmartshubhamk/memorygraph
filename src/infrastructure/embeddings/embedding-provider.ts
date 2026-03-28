/**
 * EmbeddingProviderImpl — wraps @xenova/transformers for local embedding generation.
 *
 * Uses all-MiniLM-L6-v2 (384 dimensions, ~23MB) with lazy initialisation
 * and promise-locked pipeline caching to prevent double-loading.
 */

import { pipeline } from '@xenova/transformers';
import type { EmbeddingProvider } from '../../core/interfaces/services.js';
import type { Embedding } from '../../core/models/types.js';
import type { Logger } from '../../utils/logger.js';

/**
 * The callable returned by pipeline('feature-extraction', ...).
 * We avoid importing the concrete Pipeline class to sidestep type mismatches
 * between generic Pipeline and the feature-extraction specialisation.
 */
type FeatureExtractionPipeline = (
  text: string,
  options: { pooling: string; normalize: boolean },
) => Promise<{ data: Float32Array }>;

/** Maximum texts per batch to avoid memory pressure. */
const MAX_BATCH_SIZE = 64;

export class EmbeddingProviderImpl implements EmbeddingProvider {
  private readonly modelName: string;
  private readonly logger: Logger;
  private pipe: FeatureExtractionPipeline | null = null;
  private initialisationPromise: Promise<void> | null = null;
  private ready = false;

  constructor(modelName: string, logger: Logger) {
    this.modelName = modelName;
    this.logger = logger.child({ component: 'EmbeddingProvider' });
  }

  /**
   * Returns true only after the pipeline has been successfully loaded.
   */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Lazily initialise the transformer pipeline.
   *
   * Uses a promise lock so concurrent callers share a single download/load
   * rather than triggering duplicate work.
   */
  async initialise(): Promise<void> {
    if (this.ready) {
      return;
    }

    // Promise lock — first caller creates the promise, subsequent callers await it.
    if (this.initialisationPromise) {
      await this.initialisationPromise;
      return;
    }

    this.initialisationPromise = this.loadPipeline();

    try {
      await this.initialisationPromise;
    } catch (error: unknown) {
      // Reset so a future call can retry after a transient failure.
      this.initialisationPromise = null;
      throw error;
    }
  }

  /**
   * Embed a single text string into a 384-dimension Float32Array.
   */
  async embed(text: string): Promise<Embedding> {
    await this.ensureReady();

    const sanitised = this.sanitise(text);
    if (sanitised.length === 0) {
      throw new Error('Cannot embed empty text.');
    }

    return this.runPipeline(sanitised);
  }

  /**
   * Embed multiple texts in a single pass.
   *
   * Processes sequentially within the pipeline (the model itself benefits
   * from internal batching) but guards against excessively large inputs.
   */
  async embedBatch(texts: string[]): Promise<Embedding[]> {
    if (texts.length === 0) {
      return [];
    }

    if (texts.length > MAX_BATCH_SIZE) {
      throw new Error(
        `Batch size ${texts.length} exceeds maximum of ${MAX_BATCH_SIZE}. ` +
        'Split into smaller batches to avoid memory exhaustion.',
      );
    }

    await this.ensureReady();

    const sanitised = texts.map((t) => this.sanitise(t));
    const empty = sanitised.findIndex((t) => t.length === 0);
    if (empty !== -1) {
      throw new Error(`Cannot embed empty text at batch index ${empty}.`);
    }

    const results: Embedding[] = [];
    for (const text of sanitised) {
      results.push(await this.runPipeline(text));
    }
    return results;
  }

  // ── Private helpers ──────────────────────────────────────────────────

  /**
   * Download (if needed) and load the transformer pipeline.
   */
  private async loadPipeline(): Promise<void> {
    const start = Date.now();
    this.logger.info({ model: this.modelName }, 'Initialising embedding model — first run may download ~23MB');

    try {
      this.pipe = (await pipeline('feature-extraction', this.modelName)) as unknown as FeatureExtractionPipeline;
      this.ready = true;

      const durationMs = Date.now() - start;
      this.logger.info({ model: this.modelName, durationMs }, 'Embedding model ready');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ model: this.modelName, error: message }, 'Failed to load embedding model');
      throw new Error(`Embedding model initialisation failed: ${message}`);
    }
  }

  /**
   * Ensure the pipeline is loaded before any embedding call.
   */
  private async ensureReady(): Promise<void> {
    if (!this.ready) {
      await this.initialise();
    }
  }

  /**
   * Run the pipeline on a single sanitised text and return a Float32Array.
   */
  private async runPipeline(text: string): Promise<Embedding> {
    if (!this.pipe) {
      throw new Error('Embedding pipeline is not initialised.');
    }

    const output = await this.pipe(text, { pooling: 'mean', normalize: true });
    // output.data is the raw typed array from the model
    const data = output.data;

    if (!(data instanceof Float32Array)) {
      // Defensive — ensure we always return Float32Array regardless of model output type.
      return new Float32Array(data as ArrayLike<number>);
    }

    return data;
  }

  /**
   * Sanitise input text: trim whitespace and collapse internal runs.
   */
  private sanitise(text: string): string {
    return text.trim().replace(/\s+/g, ' ');
  }
}
