import { requireEnv } from '../../../core/utils/ConfigValidator';

describe('requireEnv', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('returns values when all required vars are present', () => {
    process.env.TEST_A = 'a';
    process.env.TEST_B = 'b';
    const values = requireEnv(['TEST_A', 'TEST_B']);
    expect(values).toEqual({ TEST_A: 'a', TEST_B: 'b' });
  });

  it('throws listing every missing var', () => {
    delete process.env.TEST_A;
    delete process.env.TEST_B;
    process.env.TEST_C = 'c';
    expect(() => requireEnv(['TEST_A', 'TEST_B', 'TEST_C'])).toThrow(/TEST_A, TEST_B/);
  });

  it('treats empty and whitespace-only values as missing', () => {
    process.env.TEST_EMPTY = '';
    process.env.TEST_WS = '   ';
    expect(() => requireEnv(['TEST_EMPTY'])).toThrow(/TEST_EMPTY/);
    expect(() => requireEnv(['TEST_WS'])).toThrow(/TEST_WS/);
  });

  it('does not throw for an empty requirement list', () => {
    expect(requireEnv([])).toEqual({});
  });
});
