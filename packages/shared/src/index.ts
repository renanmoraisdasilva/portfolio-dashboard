/**
 * `@portfolio-dashboard/shared` — contracts and pure domain logic shared by
 * `apps/api` and `apps/web`.
 *
 * Built to `dist/` (`npm run build --workspace packages/shared`); the root
 * `build`, `typecheck` and `dev` scripts build it first, and Jest maps the
 * package name to this source tree so tests never need a build step.
 *
 * Populated incrementally as each domain module was extracted.
 */
export * from './domain/analyticsInsights';
export * from './domain/money';
export * from './domain/portfolio';
export * from './domain/projection';
export * from './domain/valuation';
export * from './generated/api';
