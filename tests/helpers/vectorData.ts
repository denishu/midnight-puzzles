import * as fs from 'fs';
import * as path from 'path';

/**
 * Determines whether Semantle's vector-dependent tests can run.
 *
 * These tests require large data files (GloVe vectors + precomputed rankings)
 * that are NOT committed to git (see .gitignore). They should be skipped when:
 *   - Running in CI (CI_SKIP_VECTOR_TESTS is set), OR
 *   - The vector file is simply not present locally.
 *
 * Usage:
 *   const describeVectors = vectorDataAvailable() ? describe : describe.skip;
 */
export function vectorDataAvailable(): boolean {
  if (process.env.CI_SKIP_VECTOR_TESTS) {
    return false;
  }
  const vectorFile = path.join(process.cwd(), 'data/dictionaries/vectors-840b.bin');
  return fs.existsSync(vectorFile);
}
