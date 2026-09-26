/** Jest config for TypeScript tests (ts-jest) */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/../static/js'],
  testMatch: ['**/*.test.ts', '**/__tests__/**/*.test.js'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transformIgnorePatterns: ['/node_modules/(?!uuid/)'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    '\\.js$': ['ts-jest', { tsconfig: require('path').resolve(__dirname, 'tsconfig.test-js.json') }]
  },
  collectCoverage: true,
  collectCoverageFrom: [
    'src/config/**/*.ts',
    'src/financeDb.ts',
    'src/services/financeService.ts',
    'src/services/portfolioCalculator.ts',
    '../static/js/lib/format.js'
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
