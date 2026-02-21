'use strict';

const tesseract = require('node-tesseract-ocr');
const logger = require('../utils/logger');

/**
 * Run Tesseract OCR on an image file.
 * Returns extracted text string.
 */
async function runOCR(imagePath) {
  const config = {
    lang: process.env.TESSERACT_LANG || 'eng',
    oem: parseInt(process.env.TESSERACT_OEM ?? '3'),
    psm: parseInt(process.env.TESSERACT_PSM ?? '6'),
    // Additional Tesseract config for financial documents
    tessedit_char_whitelist: '',
  };

  // Optional custom binary path
  if (process.env.TESSERACT_PATH) {
    config.binary = process.env.TESSERACT_PATH;
  }

  try {
    const text = await tesseract.recognize(imagePath, config);
    logger.debug({ msg: 'OCR complete', image: imagePath, chars: text.length });
    return text;
  } catch (err) {
    logger.error({ msg: 'OCR failed', image: imagePath, error: err.message });
    throw Object.assign(new Error(`OCR failed on ${imagePath}: ${err.message}`), { code: 'OCR_ERROR' });
  }
}

/**
 * Estimate OCR confidence based on character distribution
 */
function estimateTextConfidence(text) {
  if (!text || text.length < 10) return 0;
  const alphanumeric = (text.match(/[a-zA-Z0-9]/g) || []).length;
  const total = text.replace(/\s/g, '').length;
  if (total === 0) return 0;
  return Math.min(alphanumeric / total, 1);
}

module.exports = { runOCR, estimateTextConfidence };
