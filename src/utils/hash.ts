import { createHash } from 'node:crypto';

/**
 * Generate a SHA-256 hash of content for deduplication.
 */
export function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
