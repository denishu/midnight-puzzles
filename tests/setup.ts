// Jest setup file for property-based testing and global test configuration

import * as fc from 'fast-check';

// Configure fast-check for property-based testing
beforeAll(() => {
  // Set global configuration for property-based tests
  const config: any = {
    numRuns: 100, // Minimum 100 iterations as specified in design
    verbose: process.env.NODE_ENV === 'test',
  };
  
  if (process.env.FAST_CHECK_SEED) {
    config.seed = parseInt(process.env.FAST_CHECK_SEED);
  }
  
  fc.configureGlobal(config);
});

// Global test utilities
global.console = {
  ...console,
  // Suppress console.log in tests unless explicitly needed
  log: process.env.NODE_ENV === 'test' ? jest.fn() : console.log,
  warn: console.warn,
  error: console.error,
};

// Increase timeout for property-based tests
jest.setTimeout(30000);