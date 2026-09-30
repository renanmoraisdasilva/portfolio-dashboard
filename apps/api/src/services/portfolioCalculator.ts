/**
 * Binds the shared portfolio calculator (`packages/shared/src/domain/portfolio.ts`)
 * to this API's symbol registry. The calculator itself moved to the shared
 * package; this module stays so the
 * services below keep importing it from one place.
 */
import { SYMBOLS } from '../config/symbols';
import { createPortfolioCalculator } from '@portfolio-dashboard/shared';

const calculator = createPortfolioCalculator(SYMBOLS);

export const isBRLNonBond = calculator.isBRLNonBond;
export const replayFIFOLots = calculator.replayFIFOLots;
export const computePortfolioValue = calculator.computePortfolioValue;
