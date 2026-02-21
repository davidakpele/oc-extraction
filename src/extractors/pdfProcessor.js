'use strict';

const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { fromPath } = require('pdf2pic');
const logger = require('../utils/logger');

/**
 * Detect whether a PDF has an extractable text layer.
 * Returns { hasTextLayer, pageCount, isEncrypted }
 */
async function detectTextLayer(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer, { max: 0 }); // max:0 = parse all pages

    const text = data.text || '';
    const pageCount = data.numpages || 1;

    // Heuristic: if meaningful text per page, it's a text PDF
    const avgCharsPerPage = text.length / Math.max(pageCount, 1);
    const hasTextLayer = avgCharsPerPage > 50;

    return { hasTextLayer, pageCount, isEncrypted: false };
  } catch (err) {
    if (err.message && (err.message.includes('encrypted') || err.message.includes('password'))) {
      return { hasTextLayer: false, pageCount: 0, isEncrypted: true };
    }
    logger.warn({ msg: 'pdf-parse error, assuming scanned', error: err.message });
    return { hasTextLayer: false, pageCount: 1, isEncrypted: false };
  }
}

/**
 * Extract text from each page of a text-layer PDF.
 * Returns array of strings (one per page).
 */
async function extractTextFromLayer(filePath) {
  const dataBuffer = fs.readFileSync(filePath);

  const pageTexts = [];
  let currentPage = 0;

  const options = {
    pagerender: async function(pageData) {
      const textContent = await pageData.getTextContent();
      let text = '';
      let lastY;
      for (const item of textContent.items) {
        if (lastY === item.transform[5] || !lastY) {
          text += item.str;
        } else {
          text += '\n' + item.str;
        }
        lastY = item.transform[5];
      }
      pageTexts[currentPage] = text;
      currentPage++;
      return text;
    }
  };

  await pdfParse(dataBuffer, options);
  return pageTexts;
}

/**
 * Render each page of a PDF to a PNG image.
 * Returns array of file paths.
 */
async function renderPagesToImages(filePath, dpi = 200) {
  const outputDir = path.join(
    process.env.ARTIFACTS_DIR || '/tmp/artifacts',
    path.basename(filePath, '.pdf') + '_pages'
  );

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const options = {
    density: dpi,
    saveFilename: 'page',
    savePath: outputDir,
    format: 'png',
    width: 2480,
    height: 3508,
  };

  const convert = fromPath(filePath, options);

  // Get page count first
  const { pageCount } = await detectTextLayer(filePath).catch(() => ({ pageCount: 1 }));
  const pages = Math.max(pageCount, 1);

  const imagePaths = [];
  for (let i = 1; i <= pages; i++) {
    const result = await convert(i);
    if (result && result.path) {
      imagePaths.push(result.path);
    }
  }

  logger.info({ msg: 'Rendered PDF pages to images', count: imagePaths.length, dir: outputDir });
  return imagePaths;
}

module.exports = { detectTextLayer, extractTextFromLayer, renderPagesToImages };
