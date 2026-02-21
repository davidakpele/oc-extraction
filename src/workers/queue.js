'use strict';

const Bull = require('bull');
const logger = require('../utils/logger');

let extractionQueue = null;

async function initQueue() {
  const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
  };
  if (process.env.REDIS_PASSWORD) {
    redisConfig.password = process.env.REDIS_PASSWORD;
  }

  extractionQueue = new Bull('document-extraction', { redis: redisConfig });

  extractionQueue.on('error', (err) => {
    logger.error({ msg: 'Queue error', error: err.message });
  });

  extractionQueue.on('completed', (job) => {
    logger.info({ msg: 'Job completed', jobId: job.id });
  });

  extractionQueue.on('failed', (job, err) => {
    logger.error({ msg: 'Job failed', jobId: job.id, error: err.message });
  });

  // Start the processor in the same process (or separate worker)
  const { processJob } = require('./processor');
  extractionQueue.process(parseInt(process.env.MAX_WORKERS) || 2, processJob);

  logger.info('Bull queue initialized');
  return extractionQueue;
}

function getQueue() {
  if (!extractionQueue) throw new Error('Queue not initialized');
  return extractionQueue;
}

async function addJob(data, opts = {}) {
  const queue = getQueue();
  const job = await queue.add(data, {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    timeout: parseInt(process.env.JOB_TIMEOUT) || 300000,
    removeOnComplete: { age: parseInt(process.env.JOB_RETENTION) || 604800 },
    removeOnFail: { age: parseInt(process.env.JOB_RETENTION) || 604800 },
    ...opts,
  });
  return job;
}

module.exports = { initQueue, getQueue, addJob };
