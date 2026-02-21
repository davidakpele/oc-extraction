'use strict';

const express = require('express');
const { getJob, listJobs, getResultByJobId, getArtifactsByJobId } = require('../db/models');

const router = express.Router();

// ── GET /api/v1/jobs ──────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const { status } = req.query;
    const jobs = await listJobs({ limit, offset, status });
    res.json({ jobs, limit, offset });
  } catch (err) { next(err); }
});

// ── GET /api/v1/jobs/:id ──────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (err) { next(err); }
});

// ── GET /api/v1/jobs/:id/result ───────────────────────────────────────────────
router.get('/:id/result', async (req, res, next) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    if (job.status !== 'success') {
      return res.status(202).json({
        status: job.status,
        message: job.status === 'failed'
          ? `Job failed: ${job.error_message}`
          : 'Job not yet complete',
        error_message: job.error_message || null,
      });
    }

    const result = await getResultByJobId(req.params.id);
    if (!result) return res.status(404).json({ error: 'Result not found' });

    res.json(result.json_result);
  } catch (err) { next(err); }
});

// ── GET /api/v1/jobs/:id/artifacts ────────────────────────────────────────────
router.get('/:id/artifacts', async (req, res, next) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const artifacts = await getArtifactsByJobId(req.params.id);
    res.json({ artifacts });
  } catch (err) { next(err); }
});

module.exports = router;
