/** Jest config for TypeScript tests (ts-jest) */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // The repo root, not apps/api: the suite spans apps/api/src, static/js and
  // packages/shared, and babel-plugin-istanbul (the default coverage provider)
  // only instruments files under rootDir.
  rootDir: '../..',
  roots: [
    '<rootDir>/apps/api/src',
    '<rootDir>/static/js',
    '<rootDir>/packages/shared/src',
  ],
  testMatch: ['**/*.test.ts', '**/__tests__/**/*.test.js'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Tests resolve the package through its source, so the suite never needs a
  // build step; the compiled app uses dist/ via node_modules instead.
  moduleNameMapper: {
    '^@portfolio-dashboard/shared$': '<rootDir>/packages/shared/src/index.ts',
  },
  transformIgnorePatterns: ['/node_modules/(?!uuid/)'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
    '\\.js$': ['ts-jest', { tsconfig: require('path').resolve(__dirname, 'tsconfig.test-js.json') }]
  },
  collectCoverage: true,
  // Narrow by design: only files that are genuinely test-covered go in here.
  // Widening past this list means adding tests first — see the Phase 3 bullet.
  collectCoverageFrom: [
    'apps/api/src/config/**/*.ts',
    'apps/api/src/schema.ts',
    'apps/api/src/routes/health.ts',
    'apps/api/src/services/cashBackfill.ts',
    'apps/api/src/services/portfolioCalculator.ts',
    'packages/shared/src/domain/**/*.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    }
  }
};
