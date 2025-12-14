module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests', '<rootDir>/core', '<rootDir>/games', '<rootDir>/bot'],
  testMatch: [
    '**/__tests__/**/*.ts',
    '**/?(*.)+(spec|test).ts'
  ],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'core/**/*.ts',
    'games/**/*.ts',
    'bot/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/dist/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  moduleNameMapper: {
    '^@core/(.*)$': '<rootDir>/core/$1',
    '^@games/(.*)$': '<rootDir>/games/$1',
    '^@data/(.*)$': '<rootDir>/data/$1',
    '^@bot/(.*)$': '<rootDir>/bot/$1'
  },
  testTimeout: 10000,
  // Property-based testing configuration
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json'
    }
  }
};