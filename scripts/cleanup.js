#!/usr/bin/env node
'use strict';

/**
 * Retention Cleanup Script
 * Deletes old uploaded PDFs and artifacts based on configured retention periods.
 * Run via cron: 0 2 * * * node /app/scripts/cleanup.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { initDb, query } = require('../src/db/connection');
const logger = require('../src/utils/logger');

const PDF_RETENTION_DAYS = parseInt(process.env.PDF_RETENTION_DAYS || '90');
const ARTIFACT_RETENTION_DAYS = parseInt(process.env.ARTIFACT_RETENTION_DAYS || '30');

async function cleanup() {
  await initDb();
  logger.info('Starting retention cleanup...');

  const now = new Date();
  let filesDeleted = 0;

  // ── Clean old PDFs ─────────────────────────────────────────
  if (PDF_RETENTION_DAYS > 0) {
    const cutoff = new Date(now.getTime() - PDF_RETENTION_DAYS * 86400000);
    const oldDocs = await query(
      `SELECT id, stored_path FROM documents WHERE created_at < ? AND deleted_at IS NULL`,
      [cutoff]
    );

    for (const doc of oldDocs) {
      try {
        if (fs.existsSync(doc.stored_path)) {
          fs.unlinkSync(doc.stored_path);
          filesDeleted++;
          logger.info({ msg: 'Deleted PDF', path: doc.stored_path });
        }
        await query(`UPDATE documents SET deleted_at = NOW() WHERE id = ?`, [doc.id]);
      } catch (err) {
        logger.warn({ msg: 'Failed to delete PDF', path: doc.stored_path, error: err.message });
      }
    }
    logger.info({ msg: 'PDF cleanup done', count: oldDocs.length, filesDeleted });
  }

  // ── Clean old artifacts ────────────────────────────────────
  if (ARTIFACT_RETENTION_DAYS > 0) {
    const cutoff = new Date(now.getTime() - ARTIFACT_RETENTION_DAYS * 86400000);
    const oldArtifacts = await query(
      `SELECT id, file_path FROM artifacts WHERE created_at < ?`,
      [cutoff]
    );

    for (const art of oldArtifacts) {
      try {
        if (fs.existsSync(art.file_path)) {
          fs.unlinkSync(art.file_path);
          filesDeleted++;
        }
        await query(`DELETE FROM artifacts WHERE id = ?`, [art.id]);
      } catch (err) {
        logger.warn({ msg: 'Failed to delete artifact', path: art.file_path, error: err.message });
      }
    }
    logger.info({ msg: 'Artifact cleanup done', count: oldArtifacts.length });
  }

  logger.info({ msg: 'Cleanup complete', totalFilesDeleted: filesDeleted });
  process.exit(0);
}

cleanup().catch(err => {
  logger.error({ msg: 'Cleanup failed', error: err.message });
  process.exit(1);
});
