'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const logger = require('./utils/logger');
const { initDb } = require('./db/connection');
const { initQueue } = require('./workers/queue');
const documentRoutes = require('./routes/documents');
const jobRoutes = require('./routes/jobs');
const healthRoutes = require('./routes/health');
const { errorHandler } = require('./utils/errorHandler');
const { authMiddleware } = require('./utils/auth');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ──────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || origin === 'null') return callback(null, true);

    const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  methods: ['GET', 'POST', 'DELETE'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  logger.info({ msg: 'incoming request', method: req.method, url: req.url, ip: req.ip });
  next();
});

// Optional API key auth
if (process.env.API_KEY) {
  app.use(authMiddleware);
}

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/health', healthRoutes);
app.use('/api/v1/documents', documentRoutes);
app.use('/api/v1/jobs', jobRoutes);

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler
app.use(errorHandler);

// ── Startup ─────────────────────────────────────────────────────────────────
async function start() {
  try {
    logger.info('Starting OCR Extraction Engine...');
    await initDb();
    logger.info('Database connected');
    await initQueue();
    logger.info('Job queue initialized');

    const server = createServer(app);
    server.listen(PORT, () => {
      logger.info(`Server listening on port ${PORT}`);
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.info(`${signal} received, shutting down...`);
      server.close(() => process.exit(0));
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    logger.error({ msg: 'Failed to start server', error: err.message });
    process.exit(1);
  }
}

start();

module.exports = app; // for tests
