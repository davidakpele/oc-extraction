'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const { insertDocument, getDocument, getResultByDocumentId, getJobByDocumentId } = require('../db/models');
const { insertJob } = require('../db/models');
const { addJob } = require('../workers/queue');
const { createError } = require('../utils/errorHandler');

const router = express.Router();

// ── Multer Config ────────────────────────────────────────────────────────────
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../storage/uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 52428800 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || path.extname(file.originalname).toLowerCase() === '.pdf') {
      cb(null, true);
    } else {
      cb(createError('Only PDF files are accepted', 400, 'INVALID_FILE_TYPE'));
    }
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function checksumFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// ── POST /api/v1/documents/upload ────────────────────────────────────────────
// Register and queue a single document
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw createError('No file uploaded', 400, 'NO_FILE');

    const documentId = uuidv4();
    const jobId = uuidv4();
    const checksum = await checksumFile(req.file.path);

    await insertDocument({
      id: documentId,
      original_name: req.file.originalname,
      stored_path: req.file.path,
      mime_type: req.file.mimetype,
      size_bytes: req.file.size,
      checksum,
      page_count: null,
    });

    const bullJob = await addJob({
      jobId,
      documentId,
      filePath: req.file.path,
      originalName: req.file.originalname,
    });

    await insertJob({ id: jobId, document_id: documentId, queue_job_id: String(bullJob.id) });

    logger.info({ msg: 'Document uploaded and queued', documentId, jobId });

    res.status(202).json({
      document_id: documentId,
      job_id: jobId,
      status: 'queued',
      message: 'Document accepted and queued for processing',
    });
  } catch (err) {
    // Clean up file on error
    if (req.file) fs.unlink(req.file.path, () => {});
    next(err);
  }
});

// ── POST /api/v1/documents/upload-batch ──────────────────────────────────────
// Register and queue multiple documents
router.post('/upload-batch', upload.array('files', 20), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) throw createError('No files uploaded', 400, 'NO_FILES');

    const results = [];
    for (const file of req.files) {
      const documentId = uuidv4();
      const jobId = uuidv4();
      const checksum = await checksumFile(file.path);

      await insertDocument({
        id: documentId,
        original_name: file.originalname,
        stored_path: file.path,
        mime_type: file.mimetype,
        size_bytes: file.size,
        checksum,
        page_count: null,
      });

      const bullJob = await addJob({ jobId, documentId, filePath: file.path, originalName: file.originalname });
      await insertJob({ id: jobId, document_id: documentId, queue_job_id: String(bullJob.id) });

      results.push({ document_id: documentId, job_id: jobId, filename: file.originalname, status: 'queued' });
    }

    res.status(202).json({ accepted: results.length, documents: results });
  } catch (err) {
    if (req.files) req.files.forEach(f => fs.unlink(f.path, () => {}));
    next(err);
  }
});

// ── GET /api/v1/documents/:id ─────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const doc = await getDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json(doc);
  } catch (err) { next(err); }
});

// ── GET /api/v1/documents/:id/result ─────────────────────────────────────────
router.get('/:id/result', async (req, res, next) => {
  try {
    const doc = await getDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const result = await getResultByDocumentId(req.params.id);
    if (!result) {
      const job = await getJobByDocumentId(req.params.id);
      return res.status(202).json({
        status: job?.status || 'queued',
        message: 'Result not yet available. Check job status.',
        job_id: job?.id,
      });
    }

    res.json(result.json_result);
  } catch (err) { next(err); }
});

module.exports = router;
