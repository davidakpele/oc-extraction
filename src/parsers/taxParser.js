'use strict';

const { normalizeDate, normalizeAmount, getLines, cleanOCRArtifacts, calcConfidence } = require('../utils/normalize');
const logger = require('../utils/logger');

/**
 * Extract structured data from Indian tax statement (Form 26AS / TDS certificate)
 */
async function extractTaxStatement(pageTexts, fullText) {
  const warnings = [];
  const text = cleanOCRArtifacts(fullText);
  const lines = getLines(text);

  // ── Header / Summary ─────────────────────────────────────────────────────
  const header = extractTaxHeader(text, lines, warnings);

  // ── Deductor Sections ────────────────────────────────────────────────────
  const { deductors, tableWarnings } = extractDeductors(lines, text);
  warnings.push(...tableWarnings);

  if (deductors.length === 0) {
    warnings.push({ code: 'NO_DEDUCTORS', message: 'No deductor/TDS sections could be extracted.' });
  }

  const confidence = calcConfidence(header, ['pan', 'assessment_year', 'taxpayer_name']);

  return {
    output: {
      header,
      deductors,
    },
    confidence: Math.max(confidence, deductors.length > 0 ? 0.5 : 0.1),
    warnings,
  };
}

function extractTaxHeader(text, lines, warnings) {
  const header = {
    form_type: null,
    assessment_year: null,
    taxpayer_name: null,
    pan: null,
    taxpayer_address: null,
    total_amount_paid_credited: null,
    total_tax_deducted: null,
    total_tds_deposited: null,
  };

  // Form type
  const formMatch = text.match(/form\s+(26as|16a?|27d)/i);
  if (formMatch) header.form_type = formMatch[0].replace(/\s+/g, ' ').toUpperCase();

  // Assessment Year
  const ayMatch = text.match(/assessment\s+year\s*[:\-]?\s*(\d{4}\s*[-–]\s*\d{2,4})/i);
  if (ayMatch) header.assessment_year = ayMatch[1].replace(/\s/g, '');

  // PAN
  const panMatch = text.match(/PAN\s*(?:of\s+(?:taxpayer|deductee))?\s*[:\-]?\s*([A-Z]{5}\d{4}[A-Z])/i);
  if (panMatch) header.pan = panMatch[1].toUpperCase();

  // Taxpayer name
  const namePatterns = [
    /(?:name\s+of\s+(?:taxpayer|deductee|assessee)|taxpayer\s+name)\s*[:\-]?\s*([A-Z][a-zA-Z\s\.]+)/i,
    /assessee\s+name\s*[:\-]?\s*([A-Z][a-zA-Z\s\.]+)/i,
  ];
  for (const p of namePatterns) {
    const m = text.match(p);
    if (m) { header.taxpayer_name = m[1].trim(); break; }
  }

  // Total amounts from summary section
  const paidMatch = text.match(/total\s+(?:amount\s+)?paid\s*[\/]?\s*credited\s*[:\-]?\s*([₹$]?\s*[\d,\.]+)/i);
  if (paidMatch) header.total_amount_paid_credited = normalizeAmount(paidMatch[1]);

  const taxDeductedMatch = text.match(/total\s+tax\s+deducted\s*[:\-]?\s*([₹$]?\s*[\d,\.]+)/i);
  if (taxDeductedMatch) header.total_tax_deducted = normalizeAmount(taxDeductedMatch[1]);

  const tdsDepositedMatch = text.match(/total\s+TDS\s+deposited\s*[:\-]?\s*([₹$]?\s*[\d,\.]+)/i);
  if (tdsDepositedMatch) header.total_tds_deposited = normalizeAmount(tdsDepositedMatch[1]);

  return header;
}

function extractDeductors(lines, fullText) {
  const warnings = [];
  const deductors = [];

  // Find deductor sections - typically start with "Name of Deductor" or a section header
  const deductorStartPatterns = [
    /name\s+of\s+deductor/i,
    /deductor\s+(?:name|details)/i,
    /(?:Part|Section)\s+[AB]\s*[-–:]/i,
  ];

  // Split full text by deductor sections
  const deductorBlocks = splitByDeductors(lines, deductorStartPatterns);

  for (const block of deductorBlocks) {
    const blockText = block.join('\n');
    const deductor = parseDeductorBlock(block, blockText, warnings);
    if (deductor) deductors.push(deductor);
  }

  return { deductors, tableWarnings: warnings };
}

function splitByDeductors(lines, startPatterns) {
  const blocks = [];
  let currentBlock = [];
  let inBlock = false;

  for (const line of lines) {
    const isStart = startPatterns.some(p => p.test(line));
    if (isStart) {
      if (currentBlock.length > 0) blocks.push(currentBlock);
      currentBlock = [line];
      inBlock = true;
    } else if (inBlock) {
      currentBlock.push(line);
    }
  }
  if (currentBlock.length > 0) blocks.push(currentBlock);

  // If no blocks found, treat entire document as one block
  if (blocks.length === 0) blocks.push(lines);

  return blocks;
}

function parseDeductorBlock(lines, blockText, warnings) {
  const deductor = {
    name: null,
    tan: null,
    pan: null,
    total_amount_paid_credited: null,
    total_tax_deducted: null,
    total_tds_deposited: null,
    transactions: [],
  };

  // Name
  const nameMatch = blockText.match(/name\s+of\s+deductor\s*[:\-]?\s*([A-Z][^\n\r]{2,60})/i);
  if (nameMatch) deductor.name = nameMatch[1].trim();

  // TAN
  const tanMatch = blockText.match(/TAN\s*(?:of\s+deductor)?\s*[:\-]?\s*([A-Z]{4}\d{5}[A-Z])/i);
  if (tanMatch) deductor.tan = tanMatch[1].toUpperCase();

  // PAN of deductor
  const panMatch = blockText.match(/PAN\s+of\s+deductor\s*[:\-]?\s*([A-Z]{5}\d{4}[A-Z])/i);
  if (panMatch) deductor.pan = panMatch[1].toUpperCase();

  // Totals
  const paidMatch = blockText.match(/total\s+amount\s+paid\s*[\/]?\s*credited\s*[:\-]?\s*([₹$]?\s*[\d,\.]+)/i);
  if (paidMatch) deductor.total_amount_paid_credited = normalizeAmount(paidMatch[1]);

  const taxMatch = blockText.match(/total\s+tax\s+deducted\s*[:\-]?\s*([₹$]?\s*[\d,\.]+)/i);
  if (taxMatch) deductor.total_tax_deducted = normalizeAmount(taxMatch[1]);

  const depositedMatch = blockText.match(/total\s+TDS\s+deposited\s*[:\-]?\s*([₹$]?\s*[\d,\.]+)/i);
  if (depositedMatch) deductor.total_tds_deposited = normalizeAmount(depositedMatch[1]);

  // Transaction detail rows
  deductor.transactions = extractTDSTransactions(lines, blockText, warnings);

  return deductor;
}

function extractTDSTransactions(lines, blockText, warnings) {
  const transactions = [];

  // Find header row
  const headerIdx = lines.findIndex(l =>
    /section/i.test(l) && /(transaction|date)/i.test(l)
  );

  const startIdx = headerIdx !== -1 ? headerIdx + 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];

    // Skip headers and separators
    if (/^[-=\s|]+$/.test(line)) continue;
    if (/total|grand\s+total/i.test(line)) break;

    // Section code pattern (e.g., 192, 194A, 194C)
    const sectionMatch = line.match(/\b(1\d{2}[A-Z]?)\b/);
    if (!sectionMatch && headerIdx !== -1) continue;

    const dateMatches = line.match(/(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/g);
    const amounts = (line.match(/[₹$]?\s*[\d,]+\.\d{2}/g) || []).map(a => normalizeAmount(a));

    const txn = {
      section: sectionMatch ? sectionMatch[1] : null,
      transaction_date: dateMatches ? normalizeDate(dateMatches[0]) : null,
      booking_date: dateMatches && dateMatches[1] ? normalizeDate(dateMatches[1]) : null,
      status_of_booking: extractStatusOfBooking(line),
      remarks: extractRemarks(line),
      amount_paid_credited: amounts[0] ?? null,
      tax_deducted: amounts[1] ?? null,
      tds_deposited: amounts[2] ?? null,
    };

    if (txn.section || txn.transaction_date) {
      transactions.push(txn);
    }
  }

  return transactions;
}

function extractStatusOfBooking(line) {
  const m = line.match(/\b(F|U|P|O)\b/);
  if (!m) return null;
  const statusMap = { F: 'Final', U: 'Unmatched', P: 'Provisional', O: 'Overbooked' };
  return statusMap[m[1]] || m[1];
}

function extractRemarks(line) {
  const m = line.match(/remarks?\s*[:\-]?\s*([A-Za-z0-9\s\-\.]{3,50})/i);
  return m ? m[1].trim() : null;
}

module.exports = { extractTaxStatement };
