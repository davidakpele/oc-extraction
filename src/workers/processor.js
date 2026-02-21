'use strict';

const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const { updateJobStatus, insertResult, updateDocumentStatus, insertArtifact } = require('../db/models');
const { detectTextLayer, extractTextFromLayer, renderPagesToImages } = require('../extractors/pdfProcessor');
const { preprocessImage } = require('../extractors/imageProcessor');
const { runOCR } = require('../extractors/ocr');
const { classifyDocument } = require('../parsers/classifier');
const { extractBankStatement } = require('../parsers/bankParser');
const { extractTaxStatement } = require('../parsers/taxParser');
const { validateResult } = require('../schemas/validator');

const SCHEMA_VERSION = '1.0';

async function processJob(bullJob) {
  const { jobId, documentId, filePath, originalName } = bullJob.data;

  logger.info({ msg: 'Processing job', jobId, documentId, file: originalName });

  try {
    // ── 1. Update status to running ────────────────────────────────────────
    await updateJobStatus(jobId, 'running');
    await updateDocumentStatus(documentId, 'processing');
    await bullJob.progress(5);

    const warnings = [];
    const artifacts = [];

    // ── 2. Check for text layer ────────────────────────────────────────────
    let pageTexts = [];
    let isScanned = false;
    let pageCount = 1;

    const { hasTextLayer, pageCount: pc, isEncrypted } = await detectTextLayer(filePath);
    pageCount = pc;
    await updateDocumentStatus(documentId, 'processing', pageCount);
    await bullJob.progress(15);

    if (isEncrypted) {
      throw Object.assign(new Error('PDF is encrypted/password-protected'), { code: 'ENCRYPTED_PDF' });
    }

    if (hasTextLayer) {
      logger.info({ msg: 'Extracting from text layer', jobId });
      pageTexts = await extractTextFromLayer(filePath);
    } else {
      // ── 3. Scanned PDF: render → preprocess → OCR ──────────────────────
      isScanned = true;
      warnings.push({ code: 'SCANNED_PDF', message: 'Document appears to be scanned. OCR applied.' });
      logger.info({ msg: 'Scanned PDF detected, starting OCR pipeline', jobId });

      const dpi = parseInt(process.env.PDF_RENDER_DPI) || 200;
      const rawImages = await renderPagesToImages(filePath, dpi);
      await bullJob.progress(35);

      const saveArtifacts = process.env.DEBUG_ARTIFACTS === 'true';

      for (let i = 0; i < rawImages.length; i++) {
        const rawImagePath = rawImages[i];
        // Preprocess
        const processedImagePath = await preprocessImage(rawImagePath);

        if (saveArtifacts) {
          const artifactId = uuidv4();
          artifacts.push({ id: artifactId, document_id: documentId, job_id: jobId, artifact_type: 'processed_image', file_path: processedImagePath, page_number: i + 1 });
        }

        // OCR
        const text = await runOCR(processedImagePath);
        pageTexts.push(text);

        if (saveArtifacts) {
          const txtPath = processedImagePath.replace(/\.(png|jpg)$/, '_ocr.txt');
          require('fs').writeFileSync(txtPath, text, 'utf8');
          const artifactId = uuidv4();
          artifacts.push({ id: artifactId, document_id: documentId, job_id: jobId, artifact_type: 'ocr_text', file_path: txtPath, page_number: i + 1 });
        }

        const progress = 35 + Math.round(((i + 1) / rawImages.length) * 35);
        await bullJob.progress(progress);
      }
    }

    const fullText = pageTexts.join('\n\n--- PAGE BREAK ---\n\n');

    // Check if OCR returned mostly garbage
    if (isScanned) {
      const wordCount = fullText.split(/\s+/).filter(w => w.length > 2).length;
      if (wordCount < 20) {
        warnings.push({ code: 'LOW_OCR_QUALITY', message: 'OCR produced very little readable text. The scan quality may be too poor to extract data reliably.' });
      }
    }

    // ── 4. Classify document ───────────────────────────────────────────────
    await bullJob.progress(75);
    const { documentType, confidence: classifyConfidence } = classifyDocument(fullText, originalName);
    logger.info({ msg: 'Document classified', jobId, documentType, classifyConfidence });

    if (documentType === 'unknown') {
      warnings.push({ code: 'UNKNOWN_DOCUMENT_TYPE', message: 'Could not confidently classify document type. Attempting generic extraction.' });
    }

    // ── 5. Extract structured data ─────────────────────────────────────────
    let extractionResult;
    if (documentType === 'bank_statement') {
      extractionResult = await extractBankStatement(pageTexts, fullText);
    } else if (documentType === 'tax_statement') {
      extractionResult = await extractTaxStatement(pageTexts, fullText);
    } else {
      extractionResult = { fields: {}, tables: [], confidence: 0.1 };
    }

    await bullJob.progress(90);

    // ── 6. Build final JSON output ─────────────────────────────────────────
    const overallConfidence = Math.round(
      (classifyConfidence * 0.2 + extractionResult.confidence * 0.8) * 100
    ) / 100;

    const finalResult = {
      schema_version: SCHEMA_VERSION,
      document_id: documentId,
      document_type: documentType,
      processing: {
        is_scanned: isScanned,
        page_count: pageCount,
        ocr_applied: isScanned,
      },
      confidence: overallConfidence,
      warnings: [...warnings, ...(extractionResult.warnings || [])],
      ...extractionResult.output,
    };

    // ── 7. Validate against schema ─────────────────────────────────────────
    const { valid, errors: schemaErrors } = validateResult(finalResult, documentType);
    if (!valid) {
      schemaErrors.forEach(e => warnings.push({ code: 'SCHEMA_VALIDATION', message: e }));
      finalResult.warnings = [...finalResult.warnings, ...schemaErrors.map(e => ({ code: 'SCHEMA_VALIDATION', message: e }))];
    }

    // ── 8. Persist result ──────────────────────────────────────────────────
    const resultId = uuidv4();
    await insertResult({
      id: resultId,
      document_id: documentId,
      job_id: jobId,
      json_result: finalResult,
      schema_version: SCHEMA_VERSION,
      confidence: overallConfidence,
      document_type: documentType,
    });

    // Save debug artifacts
    for (const art of artifacts) {
      await insertArtifact(art);
    }

    await updateDocumentStatus(documentId, 'done');
    await updateJobStatus(jobId, 'success');
    await bullJob.progress(100);

    logger.info({ msg: 'Job completed successfully', jobId, documentType, confidence: overallConfidence });
    return { resultId, documentType, confidence: overallConfidence };

  } catch (err) {
    const errorMsg = err.message || 'Unknown error';
    const errorCode = err.code || 'PROCESSING_ERROR';
    logger.error({ msg: 'Job failed', jobId, documentId, error: errorMsg, code: errorCode });

    await updateJobStatus(jobId, 'failed', `[${errorCode}] ${errorMsg}`);
    await updateDocumentStatus(documentId, 'failed');
    throw err;
  }
}

module.exports = { processJob };
