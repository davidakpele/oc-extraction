'use strict';

const express = require('express');
const { getDb } = require('../db/connection');
const { getQueue } = require('../workers/queue');

const router = express.Router();

router.get('/', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: require('../../package.json').version,
    checks: {},
  };

  // DB check
  try {
    const db = getDb();
    await db.execute('SELECT 1');
    health.checks.database = { status: 'ok' };
  } catch (err) {
    health.checks.database = { status: 'error', message: err.message };
    health.status = 'degraded';
  }

  // Queue check
  try {
    const queue = getQueue();
    const counts = await queue.getJobCounts();
    health.checks.queue = { status: 'ok', counts };
  } catch (err) {
    health.checks.queue = { status: 'error', message: err.message };
    health.status = 'degraded';
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

module.exports = router;
