-- ============================================================
-- OCR Extraction Engine - MySQL DDL / Migration v1
-- Run: node migrations/run.js
-- ============================================================

-- Create database (run as admin if needed)
-- CREATE DATABASE IF NOT EXISTS ocr_engine CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- USE ocr_engine;

-- ────────────────────────────────────────────────────────────
-- documents
-- Stores file metadata for each uploaded PDF
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
    id            CHAR(36)      NOT NULL PRIMARY KEY,
    original_name VARCHAR(512)  NOT NULL,
    stored_path   VARCHAR(1024) NOT NULL,
    mime_type     VARCHAR(128)  NOT NULL DEFAULT 'application/pdf',
    size_bytes    BIGINT        NOT NULL DEFAULT 0,
    checksum      CHAR(64)      NOT NULL COMMENT 'SHA-256 hex of the stored file',
    page_count    INT           NULL,
    status        ENUM('pending','processing','done','failed') NOT NULL DEFAULT 'pending',
    created_at    DATETIME      NOT NULL,
    updated_at    DATETIME      NOT NULL,
    deleted_at    DATETIME      NULL COMMENT 'Soft-delete timestamp for retention policy',
    INDEX idx_documents_status (status),
    INDEX idx_documents_checksum (checksum),
    INDEX idx_documents_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────────────────────
-- jobs
-- Tracks async processing job lifecycle per document
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
    id              CHAR(36)    NOT NULL PRIMARY KEY,
    document_id     CHAR(36)    NOT NULL,
    queue_job_id    VARCHAR(64) NULL COMMENT 'Bull queue job ID',
    status          ENUM('queued','running','success','failed') NOT NULL DEFAULT 'queued',
    error_message   TEXT        NULL,
    started_at      DATETIME    NULL,
    completed_at    DATETIME    NULL,
    created_at      DATETIME    NOT NULL,
    updated_at      DATETIME    NOT NULL,
    CONSTRAINT fk_jobs_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    INDEX idx_jobs_document (document_id),
    INDEX idx_jobs_status (status),
    INDEX idx_jobs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────────────────────
-- results
-- Stores the final extraction JSON output
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS results (
    id              CHAR(36)    NOT NULL PRIMARY KEY,
    document_id     CHAR(36)    NOT NULL,
    job_id          CHAR(36)    NOT NULL,
    document_type   VARCHAR(64) NOT NULL,
    schema_version  VARCHAR(16) NOT NULL DEFAULT '1.0',
    confidence      DECIMAL(4,3) NOT NULL DEFAULT 0.000,
    json_result     LONGTEXT    NOT NULL COMMENT 'Full structured JSON output',
    created_at      DATETIME    NOT NULL,
    CONSTRAINT fk_results_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    CONSTRAINT fk_results_job      FOREIGN KEY (job_id)      REFERENCES jobs(id)      ON DELETE CASCADE,
    INDEX idx_results_document (document_id),
    INDEX idx_results_job (job_id),
    INDEX idx_results_type (document_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────────────────────
-- artifacts
-- Optional: paths to OCR text / debug images
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS artifacts (
    id              CHAR(36)    NOT NULL PRIMARY KEY,
    document_id     CHAR(36)    NOT NULL,
    job_id          CHAR(36)    NOT NULL,
    artifact_type   ENUM('ocr_text','processed_image','raw_image','debug_log') NOT NULL,
    file_path       VARCHAR(1024) NOT NULL,
    page_number     INT         NULL,
    created_at      DATETIME    NOT NULL,
    CONSTRAINT fk_artifacts_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    CONSTRAINT fk_artifacts_job      FOREIGN KEY (job_id)      REFERENCES jobs(id)      ON DELETE CASCADE,
    INDEX idx_artifacts_job (job_id),
    INDEX idx_artifacts_document (document_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────────────────────
-- migration_log
-- Tracks which migrations have been applied
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS migration_log (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    version     VARCHAR(64) NOT NULL UNIQUE,
    applied_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO migration_log (version, applied_at) VALUES ('v1_initial', NOW());
