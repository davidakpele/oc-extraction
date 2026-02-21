'use strict';

const { query, queryOne } = require('./connection');

// ── Documents ────────────────────────────────────────────────────────────────

async function insertDocument({ id, original_name, stored_path, mime_type, size_bytes, checksum, page_count }) {
  await query(
    `INSERT INTO documents (id, original_name, stored_path, mime_type, size_bytes, checksum, page_count, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NOW(), NOW())`,
    [id, original_name, stored_path, mime_type, size_bytes, checksum, page_count ?? null]
  );
}

async function getDocument(id) {
  return queryOne('SELECT * FROM documents WHERE id = ?', [id]);
}

async function updateDocumentStatus(id, status, page_count = null) {
  await query(
    `UPDATE documents SET status = ?, page_count = COALESCE(?, page_count), updated_at = NOW() WHERE id = ?`,
    [status, page_count, id]
  );
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

async function insertJob({ id, document_id, queue_job_id }) {
  await query(
    `INSERT INTO jobs (id, document_id, queue_job_id, status, created_at, updated_at)
     VALUES (?, ?, ?, 'queued', NOW(), NOW())`,
    [id, document_id, queue_job_id]
  );
}

async function getJob(id) {
  return queryOne(
    `SELECT j.*, d.original_name, d.stored_path FROM jobs j
     JOIN documents d ON d.id = j.document_id
     WHERE j.id = ?`,
    [id]
  );
}

async function getJobByDocumentId(document_id) {
  return queryOne('SELECT * FROM jobs WHERE document_id = ? ORDER BY created_at DESC LIMIT 1', [document_id]);
}

async function updateJobStatus(id, status, error_message = null) {
  const now = 'NOW()';
  const startedAt = status === 'running' ? ', started_at = NOW()' : '';
  const completedAt = (status === 'success' || status === 'failed') ? ', completed_at = NOW()' : '';
  await query(
    `UPDATE jobs SET status = ?, error_message = ?${startedAt}${completedAt}, updated_at = NOW() WHERE id = ?`,
    [status, error_message, id]
  );
}

async function listJobs({ limit = 20, offset = 0, status } = {}) {
  const params = [];
  let where = '';
  if (status) {
    where = 'WHERE j.status = ?';
    params.push(status);
  }
  params.push(limit, offset);
  return query(
    `SELECT j.*, d.original_name FROM jobs j JOIN documents d ON d.id = j.document_id
     ${where} ORDER BY j.created_at DESC LIMIT ? OFFSET ?`,
    params
  );
}

// ── Results ──────────────────────────────────────────────────────────────────

async function insertResult({ id, document_id, job_id, json_result, schema_version, confidence, document_type }) {
  await query(
    `INSERT INTO results (id, document_id, job_id, json_result, schema_version, confidence, document_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [id, document_id, job_id, JSON.stringify(json_result), schema_version, confidence, document_type]
  );
}

async function getResultByJobId(job_id) {
  const row = await queryOne('SELECT * FROM results WHERE job_id = ?', [job_id]);
  if (row && row.json_result) row.json_result = JSON.parse(row.json_result);
  return row;
}

async function getResultByDocumentId(document_id) {
  const row = await queryOne('SELECT * FROM results WHERE document_id = ? ORDER BY created_at DESC LIMIT 1', [document_id]);
  if (row && row.json_result) row.json_result = JSON.parse(row.json_result);
  return row;
}

// ── Artifacts ────────────────────────────────────────────────────────────────

async function insertArtifact({ id, document_id, job_id, artifact_type, file_path, page_number }) {
  await query(
    `INSERT INTO artifacts (id, document_id, job_id, artifact_type, file_path, page_number, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [id, document_id, job_id, artifact_type, file_path, page_number ?? null]
  );
}

async function getArtifactsByJobId(job_id) {
  return query('SELECT * FROM artifacts WHERE job_id = ? ORDER BY page_number ASC', [job_id]);
}

module.exports = {
  insertDocument, getDocument, updateDocumentStatus,
  insertJob, getJob, getJobByDocumentId, updateJobStatus, listJobs,
  insertResult, getResultByJobId, getResultByDocumentId,
  insertArtifact, getArtifactsByJobId,
};
