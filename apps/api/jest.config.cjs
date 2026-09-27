/** Jest config for TypeScript tests (ts-jest) */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/../../static/js'],
  testMatch: ['**/*.test.ts', '**/__tests__/**/*.test.js'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Tests resolve the package through its source, so the suite never needs a
  // build step; the compiled app uses dist/ via node_modules instead.
  moduleNameMapper: {
    '^@portfolio-dashboard/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  },
  transformIgnorePatterns: ['/node_modules/(?!uuid/)'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    '\\.js$': ['ts-jest', { tsconfig: require('path').resolve(__dirname, 'tsconfig.test-js.json') }]
  },
  collectCoverage: true,
  collectCoverageFrom: [
    'src/config/**/*.ts',
    'src/services/portfolioCalculator.ts',
    '../../packages/shared/src/domain/**/*.ts',
    '../../static/js/lib/format.js'
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
