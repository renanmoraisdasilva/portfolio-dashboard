/**
 * `@portfolio-dashboard/shared` — contracts and pure domain logic shared by
 * `apps/api` and (from Phase 4) `apps/web`.
 *
 * Built to `dist/` (`npm run build --workspace packages/shared`); the root
 * `build`, `typecheck` and `dev` scripts build it first, and Jest maps the
 * package name to this source tree so tests never need a build step.
 *
 * Populated incrementally in Phase 2 of docs/MODERNIZATION-PLAN.md.
 */
export * from './domain/money';
export * from './domain/portfolio';
export * from './generated/api';
