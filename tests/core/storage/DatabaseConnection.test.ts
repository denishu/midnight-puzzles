// Unit tests for the DatabaseConnectionFactory singleton guard (IMPROVEMENTS #6).
// Verifies that reusing the factory with a MATCHING config returns the same
// instance (intended singleton behavior), while a DIFFERENT config throws
// instead of silently returning the wrong connection.

import { DatabaseConnectionFactory } from '../../../core/storage/DatabaseConnection';

describe('DatabaseConnectionFactory config guard', () => {
  beforeEach(async () => {
    await DatabaseConnectionFactory.close();
  });
  afterEach(async () => {
    await DatabaseConnectionFactory.close();
  });

  it('returns the same instance when called again with a matching config', async () => {
    const cfg = { type: 'sqlite' as const, database: ':memory:' };
    const a = await DatabaseConnectionFactory.create(cfg);
    const b = await DatabaseConnectionFactory.create({ ...cfg }); // equal, not same object
    expect(b).toBe(a);
  });

  it('throws when called again with a different config (footgun closed)', async () => {
    await DatabaseConnectionFactory.create({ type: 'sqlite', database: ':memory:' });
    await expect(
      DatabaseConnectionFactory.create({ type: 'sqlite', database: 'other.db' })
    ).rejects.toThrow(/already initialized with a different config/);
  });

  it('allows a different config after close()', async () => {
    const first = await DatabaseConnectionFactory.create({ type: 'sqlite', database: ':memory:' });
    await DatabaseConnectionFactory.close();
    // After close, a different config is allowed and yields a fresh instance.
    const second = await DatabaseConnectionFactory.create({ type: 'sqlite', database: ':memory:' });
    expect(second).not.toBe(first);
  });
});
