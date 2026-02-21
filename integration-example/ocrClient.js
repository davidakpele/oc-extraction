/**
 * ================================================================
 * OCR Engine - Node.js Integration Example
 * ================================================================
 * Copy this file into your Next.js/Node.js backend.
 * Install: npm install axios form-data
 * ================================================================
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

// ── Config ───────────────────────────────────────────────────
const OCR_ENGINE_URL = process.env.OCR_ENGINE_URL || 'http://localhost:3001';
const OCR_API_KEY = process.env.OCR_API_KEY || '';         // if you set API_KEY in the engine
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_POLL_TIMEOUT_MS = 120000;

function getHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (OCR_API_KEY) headers['x-api-key'] = OCR_API_KEY;
  return headers;
}

// ── 1. Upload a single document ──────────────────────────────
/**
 * Upload a PDF file to the extraction engine.
 * @param {string} filePath - Absolute path to the PDF on disk
 * @returns {{ document_id, job_id, status }}
 */
async function uploadDocument(filePath) {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath), {
    filename: path.basename(filePath),
    contentType: 'application/pdf',
  });

  const response = await axios.post(
    `${OCR_ENGINE_URL}/api/v1/documents/upload`,
    form,
    {
      headers: { ...form.getHeaders(), ...(OCR_API_KEY ? { 'x-api-key': OCR_API_KEY } : {}) },
      maxBodyLength: Infinity,
    }
  );

  return response.data; // { document_id, job_id, status: 'queued' }
}

// ── 2. Upload multiple documents (batch) ─────────────────────
/**
 * Upload multiple PDFs in one request.
 * @param {string[]} filePaths
 * @returns {{ accepted, documents[] }}
 */
async function uploadDocumentsBatch(filePaths) {
  const form = new FormData();
  for (const fp of filePaths) {
    form.append('files', fs.createReadStream(fp), {
      filename: path.basename(fp),
      contentType: 'application/pdf',
    });
  }

  const response = await axios.post(
    `${OCR_ENGINE_URL}/api/v1/documents/upload-batch`,
    form,
    {
      headers: { ...form.getHeaders(), ...(OCR_API_KEY ? { 'x-api-key': OCR_API_KEY } : {}) },
      maxBodyLength: Infinity,
    }
  );

  return response.data;
}

// ── 3. Get job status ─────────────────────────────────────────
/**
 * @param {string} jobId
 * @returns {{ id, status, error_message, created_at, completed_at, ... }}
 */
async function getJobStatus(jobId) {
  const response = await axios.get(
    `${OCR_ENGINE_URL}/api/v1/jobs/${jobId}`,
    { headers: getHeaders() }
  );
  return response.data;
}

// ── 4. Get extraction result ──────────────────────────────────
/**
 * @param {string} jobId
 * @returns {object} Structured JSON result (bank_statement or tax_statement schema)
 */
async function getJobResult(jobId) {
  const response = await axios.get(
    `${OCR_ENGINE_URL}/api/v1/jobs/${jobId}/result`,
    { headers: getHeaders() }
  );
  return response.data;
}

// ── 5. Get debug artifacts ────────────────────────────────────
/**
 * @param {string} jobId
 * @returns {{ artifacts[] }}
 */
async function getJobArtifacts(jobId) {
  const response = await axios.get(
    `${OCR_ENGINE_URL}/api/v1/jobs/${jobId}/artifacts`,
    { headers: getHeaders() }
  );
  return response.data;
}

// ── Helper: Poll until complete ───────────────────────────────
/**
 * Upload a document and wait for processing to complete.
 * Polls status and resolves with the final JSON result.
 *
 * @param {string} filePath
 * @param {{ pollIntervalMs?, pollTimeoutMs? }} opts
 * @returns {Promise<object>} Final extraction JSON
 */
async function uploadAndWait(filePath, opts = {}) {
  const pollInterval = opts.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS;
  const pollTimeout = opts.pollTimeoutMs || DEFAULT_POLL_TIMEOUT_MS;

  // 1. Upload
  const { job_id } = await uploadDocument(filePath);
  console.log(`Document queued. job_id=${job_id}`);

  // 2. Poll
  const deadline = Date.now() + pollTimeout;
  while (Date.now() < deadline) {
    const job = await getJobStatus(job_id);

    if (job.status === 'success') {
      console.log(`Job complete. Fetching result...`);
      return await getJobResult(job_id);
    }

    if (job.status === 'failed') {
      throw new Error(`OCR job failed: ${job.error_message}`);
    }

    // Still queued/running
    console.log(`Job status: ${job.status}. Waiting ${pollInterval}ms...`);
    await new Promise(r => setTimeout(r, pollInterval));
  }

  throw new Error(`Timed out waiting for job ${job_id} after ${pollTimeout}ms`);
}

// ── Health check ──────────────────────────────────────────────
async function checkEngineHealth() {
  const response = await axios.get(`${OCR_ENGINE_URL}/health`);
  return response.data;
}

// ── Example usage ─────────────────────────────────────────────
async function exampleUsage() {
  try {
    // Check health
    const health = await checkEngineHealth();
    console.log('Engine health:', health.status);

    // Upload and wait for result
    const result = await uploadAndWait('./sample-statement.pdf', {
      pollIntervalMs: 3000,
      pollTimeoutMs: 180000,
    });

    console.log('Document type:', result.document_type);
    console.log('Confidence:', result.confidence);

    if (result.document_type === 'bank_statement') {
      console.log('Account number:', result.header.account_number);
      console.log('Transactions:', result.transactions.length);
    } else if (result.document_type === 'tax_statement') {
      console.log('PAN:', result.header.pan);
      console.log('Deductors:', result.deductors.length);
    }

    // Warnings
    if (result.warnings?.length) {
      console.warn('Warnings:', result.warnings);
    }

    return result;
  } catch (err) {
    console.error('Error:', err.message);
    throw err;
  }
}

// ── Next.js API Route example ─────────────────────────────────
// pages/api/upload-statement.js or app/api/upload-statement/route.js
//
// import { uploadAndWait } from '@/lib/ocrClient';
// import { writeFile } from 'fs/promises';
// import { tmpdir } from 'os';
// import path from 'path';
//
// export async function POST(req) {
//   const formData = await req.formData();
//   const file = formData.get('file');
//   const buffer = Buffer.from(await file.arrayBuffer());
//   const tmpPath = path.join(tmpdir(), `upload_${Date.now()}.pdf`);
//   await writeFile(tmpPath, buffer);
//
//   try {
//     const result = await uploadAndWait(tmpPath);
//     return Response.json({ success: true, result });
//   } catch (err) {
//     return Response.json({ success: false, error: err.message }, { status: 500 });
//   }
// }

module.exports = {
  uploadDocument,
  uploadDocumentsBatch,
  getJobStatus,
  getJobResult,
  getJobArtifacts,
  uploadAndWait,
  checkEngineHealth,
};

// Run example if called directly
if (require.main === module) {
  exampleUsage().then(console.log).catch(console.error);
}
