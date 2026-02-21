'use strict';

/**
 * Integration tests for the REST API.
 * These require a running MySQL + Redis (use docker-compose for test env).
 * Skip in CI without infra: jest --testPathIgnorePatterns=integration
 */

const request = require('supertest');
const path = require('path');
const fs = require('fs');

// Minimal mock setup for unit-level API tests (no real DB/queue)
jest.mock('../src/db/connection', () => ({
  initDb: jest.fn().mockResolvedValue({}),
  getDb: jest.fn().mockReturnValue({ execute: jest.fn().mockResolvedValue([[]]) }),
  query: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
}));

jest.mock('../src/workers/queue', () => ({
  initQueue: jest.fn().mockResolvedValue({}),
  getQueue: jest.fn().mockReturnValue({ add: jest.fn().mockResolvedValue({ id: '1' }) }),
  addJob: jest.fn().mockResolvedValue({ id: '1' }),
}));

jest.mock('../src/db/models', () => ({
  insertDocument: jest.fn().mockResolvedValue(),
  getDocument: jest.fn().mockResolvedValue(null),
  updateDocumentStatus: jest.fn().mockResolvedValue(),
  insertJob: jest.fn().mockResolvedValue(),
  getJob: jest.fn().mockResolvedValue(null),
  getJobByDocumentId: jest.fn().mockResolvedValue(null),
  updateJobStatus: jest.fn().mockResolvedValue(),
  listJobs: jest.fn().mockResolvedValue([]),
  insertResult: jest.fn().mockResolvedValue(),
  getResultByJobId: jest.fn().mockResolvedValue(null),
  getResultByDocumentId: jest.fn().mockResolvedValue(null),
  insertArtifact: jest.fn().mockResolvedValue(),
  getArtifactsByJobId: jest.fn().mockResolvedValue([]),
}));

let app;
beforeAll(() => {
  process.env.UPLOAD_DIR = '/tmp/ocr-test-uploads';
  fs.mkdirSync('/tmp/ocr-test-uploads', { recursive: true });
  app = require('../src/index');
});

describe('GET /health', () => {
  it('returns 200 with status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBeLessThanOrEqual(503);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('timestamp');
  });
});

describe('POST /api/v1/documents/upload', () => {
  it('returns 400 when no file uploaded', async () => {
    const res = await request(app).post('/api/v1/documents/upload');
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-PDF file', async () => {
    const txtFile = '/tmp/test.txt';
    fs.writeFileSync(txtFile, 'not a pdf');
    const res = await request(app)
      .post('/api/v1/documents/upload')
      .attach('file', txtFile);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/jobs', () => {
  it('returns job list', async () => {
    const res = await request(app).get('/api/v1/jobs');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('jobs');
    expect(Array.isArray(res.body.jobs)).toBe(true);
  });
});

describe('GET /api/v1/jobs/:id', () => {
  it('returns 404 for missing job', async () => {
    const res = await request(app).get('/api/v1/jobs/non-existent-id');
    expect(res.status).toBe(404);
  });
});
