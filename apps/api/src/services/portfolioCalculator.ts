import { SYMBOLS } from '../config/symbols';
import { createPortfolioCalculator } from '@portfolio-dashboard/shared';

const calculator = createPortfolioCalculator(SYMBOLS);

export const isBRLNonBond = calculator.isBRLNonBond;
export const replayFIFOLots = calculator.replayFIFOLots;
