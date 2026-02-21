'use strict';

const { parse: parseDate, isValid, format } = require('date-fns');

/**
 * Parse a date string in various formats → ISO 8601 (YYYY-MM-DD)
 */
const DATE_FORMATS = [
  'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd',
  'dd-MM-yyyy', 'MM-dd-yyyy', 'd/M/yyyy', 'd-M-yyyy',
  'dd MMM yyyy', 'dd-MMM-yyyy', 'MMM dd, yyyy', 'MMM d, yyyy',
  'dd.MM.yyyy', 'yyyy/MM/dd',
];

function normalizeDate(raw) {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  for (const fmt of DATE_FORMATS) {
    try {
      const parsed = parseDate(cleaned, fmt, new Date());
      if (isValid(parsed)) {
        return format(parsed, 'yyyy-MM-dd');
      }
    } catch (_) {}
  }
  // Try JS native parser as fallback
  const native = new Date(cleaned);
  if (isValid(native) && native.getFullYear() > 1990) {
    return format(native, 'yyyy-MM-dd');
  }
  return null;
}

/**
 * Parse amount string → float (handles commas, parentheses for negatives, currency symbols)
 */
function normalizeAmount(raw) {
  if (!raw) return null;
  let str = String(raw).trim();
  // Remove currency symbols and spaces
  str = str.replace(/[₹$€£¥₩,\s]/g, '');
  // Handle parentheses = negative
  const isNegative = str.startsWith('(') && str.endsWith(')') || str.startsWith('-');
  str = str.replace(/[()]/g, '').replace(/^-/, '');
  const amount = parseFloat(str);
  if (isNaN(amount)) return null;
  return isNegative ? -amount : amount;
}

/**
 * Split text into lines, trimming and removing blank-only lines
 */
function getLines(text) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
}

/**
 * Find the line index containing a keyword
 */
function findLineIndex(lines, pattern) {
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) return i;
  }
  return -1;
}

/**
 * Extract a value after a label using regex
 */
function extractAfterLabel(text, labelPattern, valuePattern = /(.+)/) {
  const match = text.match(new RegExp(labelPattern.source + '[:\\s]+' + valuePattern.source, 'i'));
  return match ? match[1].trim() : null;
}

/**
 * Remove OCR artifacts (common misreads in financial docs)
 */
function cleanOCRArtifacts(text) {
  return text
    .replace(/[|]{2,}/g, ' ')
    .replace(/l(?=\d)/g, '1')   // common: l vs 1
    .replace(/O(?=\d)/g, '0')   // O vs 0
    .replace(/\bI(?=\d)/g, '1')
    .replace(/\s{2,}/g, ' ');
}

/**
 * Calculate overall extraction confidence based on filled fields
 */
function calcConfidence(fields, required = []) {
  const allFields = Object.keys(fields);
  if (allFields.length === 0) return 0;

  const filled = allFields.filter(k => fields[k] !== null && fields[k] !== undefined && fields[k] !== '');
  const requiredFilled = required.filter(k => fields[k] !== null && fields[k] !== undefined && fields[k] !== '');

  const fieldScore = filled.length / allFields.length;
  const requiredScore = required.length > 0 ? requiredFilled.length / required.length : 1;

  return Math.round((fieldScore * 0.4 + requiredScore * 0.6) * 100) / 100;
}

module.exports = { normalizeDate, normalizeAmount, getLines, findLineIndex, extractAfterLabel, cleanOCRArtifacts, calcConfidence };
