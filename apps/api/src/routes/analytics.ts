import { Router } from 'express';
import { getLatestSnapshots } from '../services/analyticsService';
import { ANALYTICS_CACHE_KEY, getOrSetResponse } from '../services/responseCache';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const snapshots = await getOrSetResponse(ANALYTICS_CACHE_KEY, 30_000, getLatestSnapshots);
    res.json({ snapshots });
  } catch (err) {
    console.error('[analytics] GET /api/analytics failed:', err);
    res.status(500).json({ error: 'Failed to load analytics snapshots' });
  }
});

export default router;
