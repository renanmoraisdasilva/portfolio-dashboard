/**
 * `@portfolio-dashboard/shared` — contracts and pure domain logic shared by
 * `apps/api` and (from Phase 4) `apps/web`.
 *
 * Populated incrementally in Phase 2 of docs/MODERNIZATION-PLAN.md. Nothing
 * imports this package yet: the strangler still serves plain scripts, and the
 * consumption story (build to `dist` vs. path mapping) is decided together
 * with the first real consumer.
 */
export * from './generated/api';
