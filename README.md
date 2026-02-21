# OCR Extraction Engine — Complete Runbook

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Installation & Setup](#installation--setup)
5. [Configuration Reference](#configuration-reference)
6. [API Reference](#api-reference)
7. [JSON Output Schemas](#json-output-schemas)
8. [Integration Guide (Next.js)](#integration-guide-nextjs)
9. [Retention Policy](#retention-policy)
10. [Troubleshooting](#troubleshooting)
11. [Production Checklist](#production-checklist)

---

## Overview

A fully local, self-hosted PDF extraction microservice that processes bank statements and tax statements (Form 26AS / TDS certificates) — both digital PDFs and scanned image PDFs — and returns structured JSON.

**Zero third-party API calls.** All OCR, PDF parsing, and extraction runs on your server.

### Key capabilities
- Detects text-layer PDFs → extracts directly (fast, high accuracy)
- Scanned/image PDFs → renders to images → preprocesses → Tesseract OCR
- Classifies document type automatically (bank / tax / unknown)
- Structured JSON output with confidence scores and warnings
- Async job queue (Bull + Redis) with status tracking
- All jobs/results persisted in MySQL
- REST API consumed by your Node.js/Next.js backend

---

## Architecture

```
Your Next.js App
     │
     │  HTTP (internal)
     ▼
┌─────────────────────────────────────┐
│      OCR Engine (Express API)       │
│  POST /upload  →  Bull Queue        │
│  GET  /jobs/:id/result              │
└───────────────┬─────────────────────┘
                │
     ┌──────────┴──────────┐
     ▼                     ▼
  Redis                  MySQL
(Bull queue)         (jobs/results)
                          │
              ┌───────────┴──────────┐
              ▼                      ▼
        pdf-parse              Tesseract OCR
    (text-layer PDFs)      (scanned/image PDFs)
                                     │
                               ┌─────┴──────┐
                               ▼            ▼
                            sharp       pdf2pic
                         (preprocess) (PDF→PNG)
```

### Processing pipeline

```
Upload PDF
  │
  ├─ Has text layer? ──YES──▶ pdf-parse → page texts
  │
  └─ Scanned? ──YES──▶ pdf2pic (render pages)
                         └──▶ sharp (grayscale / normalize / sharpen)
                               └──▶ Tesseract OCR → page texts
                                         │
                                  Classify document
                                  (keyword scoring)
                                         │
                              ┌──────────┴──────────┐
                              ▼                     ▼
                       Bank Parser            Tax Parser
                       (header + txns)        (header + deductors)
                              │
                       Validate JSON schema
                              │
                       Persist to MySQL
                              │
                       Return result via API
```

---

## Prerequisites

### Server Requirements
- **OS**: Ubuntu 20.04+ / Debian 11+ (or Docker on any OS)
- **RAM**: 2GB minimum (4GB recommended for concurrent processing)
- **CPU**: 2 cores minimum
- **Disk**: 20GB+ (depends on document volume and retention)
- **Node.js**: v18 or v20
- **MySQL**: 8.0+
- **Redis**: 6+ (or 7)

### System packages (bare metal / non-Docker)
```bash
sudo apt-get update && sudo apt-get install -y \
  tesseract-ocr \
  tesseract-ocr-eng \
  ghostscript \
  poppler-utils \
  graphicsmagick \
  libvips-dev
```

---

## Installation & Setup

### Option A: Docker Compose (Recommended)

**1. Clone / copy the project to your server**
```bash
git clone <your-repo> /opt/ocr-engine
cd /opt/ocr-engine
```

**2. Configure environment**
```bash
cp .env.example .env
nano .env
# Set: DB_PASSWORD, API_KEY, CORS_ORIGINS, etc.
```

**3. Build and start**
```bash
docker compose up -d --build
```

**4. Verify**
```bash
curl http://localhost:3001/health
# Should return: {"status":"ok",...}
```

**5. Check logs**
```bash
docker compose logs -f ocr-engine
```

---

### Option B: Bare Metal

**1. Install system dependencies** (see Prerequisites above)

**2. Install Node dependencies**
```bash
cd /opt/ocr-engine
npm install
```

**3. Set up MySQL**
```sql
CREATE DATABASE ocr_engine CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'ocr_user'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON ocr_engine.* TO 'ocr_user'@'localhost';
FLUSH PRIVILEGES;
```

**4. Run migrations**
```bash
cp .env.example .env
# Edit .env with your DB credentials
npm run migrate
```

**5. Start Redis** (if not already running)
```bash
sudo systemctl start redis
```

**6. Start the service**
```bash
npm start
```

**7. Production: Use PM2**
```bash
npm install -g pm2
pm2 start src/index.js --name ocr-engine
pm2 save
pm2 startup
```

---

## Configuration Reference

All configuration is via environment variables (`.env` file or Docker Compose environment).

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | API server port |
| `NODE_ENV` | `production` | Node environment |
| `DB_HOST` | `localhost` | MySQL host |
| `DB_PORT` | `3306` | MySQL port |
| `DB_NAME` | `ocr_engine` | MySQL database name |
| `DB_USER` | `ocr_user` | MySQL username |
| `DB_PASSWORD` | *(required)* | MySQL password |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | *(empty)* | Redis password |
| `UPLOAD_DIR` | `/app/storage/uploads` | Where PDFs are stored |
| `ARTIFACTS_DIR` | `/app/storage/artifacts` | Where debug images/OCR text saved |
| `MAX_FILE_SIZE` | `52428800` | Max PDF upload size in bytes (50MB) |
| `TESSERACT_LANG` | `eng` | Tesseract language(s). Use `eng+hin` for multi-language |
| `TESSERACT_OEM` | `3` | OCR Engine Mode (3 = LSTM best) |
| `TESSERACT_PSM` | `6` | Page Segmentation Mode (6 = single uniform block) |
| `PDF_RENDER_DPI` | `200` | DPI for rendering scanned PDFs (higher = slower but better) |
| `MAX_WORKERS` | `2` | Max concurrent extraction jobs |
| `JOB_TIMEOUT` | `300000` | Job timeout in milliseconds (5 min) |
| `PDF_RETENTION_DAYS` | `90` | Days to keep uploaded PDFs (0 = forever) |
| `ARTIFACT_RETENTION_DAYS` | `30` | Days to keep debug artifacts |
| `DEBUG_ARTIFACTS` | `false` | Save OCR images + text as debug artifacts |
| `API_KEY` | *(empty)* | API key for authentication (leave blank to disable) |
| `CORS_ORIGINS` | `http://localhost:3000` | Allowed CORS origins (comma-separated) |
| `LOG_LEVEL` | `info` | Log level (error/warn/info/debug) |
| `LOG_DIR` | `/app/logs` | Log file directory |

### Adding languages for OCR

For Hindi + English support:
```bash
# Docker: modify Dockerfile
RUN apt-get install -y tesseract-ocr-eng tesseract-ocr-hin
# Then set:
TESSERACT_LANG=eng+hin
```

---

## API Reference

Base URL: `http://your-server:3001`

All endpoints accept `x-api-key: <key>` header when `API_KEY` is set.

---

### 1. Upload Document

**POST** `/api/v1/documents/upload`

Upload a single PDF for processing.

**Request** (multipart/form-data):
```
file: <pdf-file>
```

**Response** `202 Accepted`:
```json
{
  "document_id": "uuid",
  "job_id": "uuid",
  "status": "queued",
  "message": "Document accepted and queued for processing"
}
```

---

### 2. Upload Batch

**POST** `/api/v1/documents/upload-batch`

Upload up to 20 PDFs at once.

**Request** (multipart/form-data):
```
files: <file1.pdf>
files: <file2.pdf>
...
```

**Response** `202 Accepted`:
```json
{
  "accepted": 2,
  "documents": [
    { "document_id": "uuid", "job_id": "uuid", "filename": "file1.pdf", "status": "queued" },
    { "document_id": "uuid", "job_id": "uuid", "filename": "file2.pdf", "status": "queued" }
  ]
}
```

---

### 3. Get Job Status

**GET** `/api/v1/jobs/:job_id`

**Response** `200 OK`:
```json
{
  "id": "uuid",
  "document_id": "uuid",
  "status": "running",
  "error_message": null,
  "created_at": "2024-01-15T10:30:00Z",
  "started_at": "2024-01-15T10:30:02Z",
  "completed_at": null
}
```

**Status values**: `queued` → `running` → `success` | `failed`

---

### 4. Get Extraction Result

**GET** `/api/v1/jobs/:job_id/result`

Returns the full structured JSON when `status = success`.

Returns `202` with status info if still processing.
Returns `202` with error details if `status = failed`.

---

### 5. Get Document Result (by document ID)

**GET** `/api/v1/documents/:document_id/result`

Same as above but addressed by document ID.

---

### 6. List Jobs

**GET** `/api/v1/jobs?status=success&limit=20&offset=0`

Query params: `status` (optional filter), `limit` (max 100), `offset`.

---

### 7. Get Debug Artifacts

**GET** `/api/v1/jobs/:job_id/artifacts`

Returns paths to OCR images/text files (when `DEBUG_ARTIFACTS=true`).

---

### 8. Health Check

**GET** `/health`

```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z",
  "version": "1.0.0",
  "checks": {
    "database": { "status": "ok" },
    "queue": { "status": "ok", "counts": { "active": 0, "waiting": 2, "completed": 145 } }
  }
}
```

---

## JSON Output Schemas

### Bank Statement

```json
{
  "schema_version": "1.0",
  "document_id": "uuid",
  "document_type": "bank_statement",
  "processing": {
    "is_scanned": false,
    "page_count": 3,
    "ocr_applied": false
  },
  "confidence": 0.87,
  "warnings": [],
  "header": {
    "bank_name": "string | null",
    "account_number": "string | null",
    "account_holder_name": "string | null",
    "account_type": "savings | current | salary | null",
    "ifsc_code": "string | null",
    "branch": "string | null",
    "statement_period_from": "YYYY-MM-DD | null",
    "statement_period_to": "YYYY-MM-DD | null",
    "opening_balance": 25430.50,
    "closing_balance": 48250.75,
    "currency": "INR"
  },
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "string | null",
      "debit": 5000.00,
      "credit": null,
      "balance": 45000.00,
      "reference": "string | null"
    }
  ]
}
```

### Tax Statement (Form 26AS)

```json
{
  "schema_version": "1.0",
  "document_id": "uuid",
  "document_type": "tax_statement",
  "processing": { "is_scanned": true, "page_count": 5, "ocr_applied": true },
  "confidence": 0.79,
  "warnings": [{ "code": "SCANNED_PDF", "message": "OCR applied." }],
  "header": {
    "form_type": "FORM 26AS",
    "assessment_year": "2024-25",
    "taxpayer_name": "string | null",
    "pan": "ABCDE1234F | null",
    "taxpayer_address": "string | null",
    "total_amount_paid_credited": 780000.00,
    "total_tax_deducted": 78000.00,
    "total_tds_deposited": 78000.00
  },
  "deductors": [
    {
      "name": "XYZ Technologies Pvt Ltd",
      "tan": "MUMX12345A",
      "pan": "AABCX1234D",
      "total_amount_paid_credited": 660000.00,
      "total_tax_deducted": 66000.00,
      "total_tds_deposited": 66000.00,
      "transactions": [
        {
          "section": "192",
          "transaction_date": "YYYY-MM-DD",
          "booking_date": "YYYY-MM-DD",
          "status_of_booking": "Final | Unmatched | Provisional | Overbooked",
          "remarks": "string | null",
          "amount_paid_credited": 55000.00,
          "tax_deducted": 5500.00,
          "tds_deposited": 5500.00
        }
      ]
    }
  ]
}
```

### Warning Codes

| Code | Meaning |
|---|---|
| `SCANNED_PDF` | Document is a scanned image; OCR was applied |
| `LOW_OCR_QUALITY` | OCR returned very little readable text; scan quality poor |
| `NO_TRANSACTIONS` | No transaction rows found in the document |
| `NO_TABLE_HEADER` | Could not find transaction table header; heuristic parsing used |
| `HEURISTIC_PARSING` | Falling back to pattern-based row parsing |
| `NO_DEDUCTORS` | No TDS deductor sections found |
| `UNKNOWN_DOCUMENT_TYPE` | Document type could not be confidently classified |
| `SCHEMA_VALIDATION` | Extracted data did not conform to expected schema |
| `ENCRYPTED_PDF` | PDF is password-protected and cannot be processed |
| `OCR_ERROR` | OCR engine returned an error |

---

## Integration Guide (Next.js)

Copy `integration-example/ocrClient.js` to your Next.js project as `lib/ocrClient.js`.

```javascript
// lib/ocrClient.js already has: uploadDocument, getJobStatus, getJobResult, uploadAndWait

// pages/api/process-statement.js (or app/api/... route)
import { uploadAndWait } from '@/lib/ocrClient';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

export const config = { api: { bodyParser: false } };

export async function POST(req) {
  const formData = await req.formData();
  const file = formData.get('file');
  
  // Save to temp file (Next.js needs disk path for streaming)
  const tmpPath = path.join(tmpdir(), `upload_${Date.now()}.pdf`);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(tmpPath, buffer);

  try {
    const result = await uploadAndWait(tmpPath, { pollTimeoutMs: 120000 });
    return Response.json({ success: true, result });
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}
```

**Environment variables for your Next.js app:**
```
OCR_ENGINE_URL=http://localhost:3001
OCR_API_KEY=your_api_key_here   # if you set API_KEY in .env
```

---

## Retention Policy

### File Storage Strategy
- PDFs are stored on disk at `UPLOAD_DIR` with UUID filenames
- The original filename is stored in MySQL `documents.original_name`
- Checksums (SHA-256) prevent processing duplicates

### Automated Cleanup (Cron)
```bash
# Add to crontab: runs daily at 2 AM
0 2 * * * node /opt/ocr-engine/scripts/cleanup.js >> /var/log/ocr-cleanup.log 2>&1
```

The cleanup script:
1. Soft-deletes documents older than `PDF_RETENTION_DAYS` (sets `deleted_at`)
2. Physically removes the PDF file from disk
3. Deletes artifact files older than `ARTIFACT_RETENTION_DAYS`

To keep PDFs forever: set `PDF_RETENTION_DAYS=0`

---

## Troubleshooting

### Engine won't start
```bash
# Check logs
docker compose logs ocr-engine

# Common causes:
# - MySQL/Redis not ready → wait and retry
# - Wrong DB credentials → check .env
# - Port 3001 in use → change PORT
```

### OCR producing garbage text
- Increase DPI: `PDF_RENDER_DPI=300`
- Enable debug artifacts: `DEBUG_ARTIFACTS=true`, then inspect processed images at the artifacts path
- Check Tesseract language: `TESSERACT_LANG=eng+hin` for Indian documents with Hindi text

### "Encrypted PDF" error
- The PDF is password-protected. Remove the password using `qpdf`:
  ```bash
  qpdf --password=YOURPASS --decrypt input.pdf output.pdf
  ```

### Very low confidence scores
- Enable `DEBUG_ARTIFACTS=true` and examine the OCR text output
- The document layout may be unusual; file an issue with a sanitized sample

### MySQL connection errors
```bash
# Test connection
mysql -h 127.0.0.1 -u ocr_user -p ocr_engine
# Run migrations manually
npm run migrate
```

### Jobs stuck in "queued"
```bash
# Check Redis connection
redis-cli ping
# Check Bull queue
docker compose logs ocr-engine | grep "Queue"
```

### Performance tuning
- Increase `MAX_WORKERS` for more parallelism (but CPU-bound by Tesseract)
- Reduce `PDF_RENDER_DPI` to `150` for faster (slightly lower quality) OCR
- Use SSD storage for `UPLOAD_DIR` and `ARTIFACTS_DIR`

---

## Production Checklist

- [ ] Change all default passwords in `.env`
- [ ] Set a strong `API_KEY`
- [ ] Set `CORS_ORIGINS` to your Next.js domain only
- [ ] Set `NODE_ENV=production`
- [ ] Remove exposed MySQL/Redis ports from `docker-compose.yml`
- [ ] Set up log rotation (handled automatically by Winston daily-rotate)
- [ ] Configure cron for `scripts/cleanup.js`
- [ ] Set up monitoring on `/health` endpoint
- [ ] Back up MySQL regularly (volumes in Docker Compose)
- [ ] Set appropriate `PDF_RETENTION_DAYS` per your compliance requirements
- [ ] Test with sample PDFs of each type before going live
- [ ] Run `npm test` and verify all tests pass
