'use strict';

const { normalizeDate, normalizeAmount, getLines, cleanOCRArtifacts, calcConfidence } = require('../utils/normalize');
const logger = require('../utils/logger');

/**
 * Extract structured data from bank statement text.
 */
async function extractBankStatement(pageTexts, fullText) {
  const warnings = [];
  const text = cleanOCRArtifacts(fullText);
  const lines = getLines(text);

  // ── Header / Summary Fields ──────────────────────────────────────────────
  const header = extractHeader(text, lines, warnings);

  // ── Transaction Table ────────────────────────────────────────────────────
  const { transactions, tableWarnings } = extractTransactions(lines, text);
  warnings.push(...tableWarnings);

  if (transactions.length === 0) {
    warnings.push({ code: 'NO_TRANSACTIONS', message: 'No transaction rows could be extracted from this document.' });
  }

  const confidence = calcConfidence(header, ['account_number', 'statement_period_from', 'statement_period_to']);

  return {
    output: {
      header,
      transactions,
    },
    confidence: Math.max(confidence, transactions.length > 0 ? 0.5 : 0.1),
    warnings,
  };
}

function extractHeader(text, lines, warnings) {
  const header = {
    bank_name: null,
    account_number: null,
    account_holder_name: null,
    account_type: null,
    ifsc_code: null,
    branch: null,
    statement_period_from: null,
    statement_period_to: null,
    opening_balance: null,
    closing_balance: null,
    currency: 'INR',
  };

  // Bank name (usually in first few lines or header)
  const bankNameMatch = text.match(/([A-Z][A-Za-z\s]+(?:Bank|BANK|banking|BANKING)[A-Za-z\s]*)/);
  if (bankNameMatch) header.bank_name = bankNameMatch[1].trim();

  // Account number
  const acctPatterns = [
    /account\s+(?:number|no\.?|#)\s*[:\-]?\s*(\d[\d\s\-]{5,20})/i,
    /a\/c\s+(?:no\.?|number|#)\s*[:\-]?\s*(\d[\d\s\-]{5,20})/i,
    /acc(?:ount)?\s*no[.:]?\s*(\d[\d\s\-]{5,20})/i,
  ];
  for (const p of acctPatterns) {
    const m = text.match(p);
    if (m) { header.account_number = m[1].replace(/\s/g, ''); break; }
  }

  // Account holder name
  const namePatterns = [
    /(?:account\s+holder|customer\s+name|name)\s*[:\-]?\s*([A-Z][a-zA-Z\s\.]+)/i,
    /in\s+the\s+name\s+of\s*[:\-]?\s*([A-Z][a-zA-Z\s\.]+)/i,
  ];
  for (const p of namePatterns) {
    const m = text.match(p);
    if (m) { header.account_holder_name = m[1].trim(); break; }
  }

  // Account type
  const typeMatch = text.match(/(savings|current|salary|nre|nro|fixed\s+deposit)\s*account/i);
  if (typeMatch) header.account_type = typeMatch[1].toLowerCase();

  // IFSC
  const ifscMatch = text.match(/IFSC\s*[:\-]?\s*([A-Z]{4}0[A-Z0-9]{6})/i);
  if (ifscMatch) header.ifsc_code = ifscMatch[1].toUpperCase();

  // Statement period
  const periodPatterns = [
    /(?:statement|from)\s+(?:period|date)\s*[:\-]?\s*([\d\/\-\.]+\s*(?:to|[-–])\s*[\d\/\-\.]+)/i,
    /period\s*[:\-]?\s*([\d\/\-\.a-zA-Z]+)\s+to\s+([\d\/\-\.a-zA-Z]+)/i,
    /from\s*[:\-]?\s*([\d\/\-\.a-zA-Z]+)\s+to\s+([\d\/\-\.a-zA-Z]+)/i,
  ];
  for (const p of periodPatterns) {
    const m = text.match(p);
    if (m) {
      if (m[2]) {
        header.statement_period_from = normalizeDate(m[1]);
        header.statement_period_to = normalizeDate(m[2]);
      } else {
        const parts = m[1].split(/\s+to\s+|[-–]/i);
        if (parts.length === 2) {
          header.statement_period_from = normalizeDate(parts[0]);
          header.statement_period_to = normalizeDate(parts[1]);
        }
      }
      if (header.statement_period_from) break;
    }
  }

  // Opening balance
  const openBalPatterns = [
    /opening\s+balance\s*[:\-]?\s*([₹$]?\s*[\d,\.]+(?:\.\d{2})?)/i,
    /balance\s+b\/f\s*[:\-]?\s*([₹$]?\s*[\d,\.]+)/i,
  ];
  for (const p of openBalPatterns) {
    const m = text.match(p);
    if (m) { header.opening_balance = normalizeAmount(m[1]); break; }
  }

  // Closing balance
  const closeBalPatterns = [
    /closing\s+balance\s*[:\-]?\s*([₹$]?\s*[\d,\.]+(?:\.\d{2})?)/i,
    /balance\s+c\/f\s*[:\-]?\s*([₹$]?\s*[\d,\.]+)/i,
  ];
  for (const p of closeBalPatterns) {
    const m = text.match(p);
    if (m) { header.closing_balance = normalizeAmount(m[1]); break; }
  }

  // Currency
  if (/₹|INR/.test(text)) header.currency = 'INR';
  else if (/\$|USD/.test(text)) header.currency = 'USD';
  else if (/£|GBP/.test(text)) header.currency = 'GBP';
  else if (/€|EUR/.test(text)) header.currency = 'EUR';

  return header;
}

function extractTransactions(lines, fullText) {
  const warnings = [];
  const transactions = [];

  // Find the table header row
  const headerPatterns = [
    /date.*(?:narration|description|particulars).*(?:debit|dr).*(?:credit|cr)/i,
    /date.*(?:details|description).*(?:withdrawal|debit).*(?:deposit|credit)/i,
    /txn.*date.*description/i,
  ];

  let headerLineIdx = -1;
  for (const p of headerPatterns) {
    headerLineIdx = lines.findIndex(l => p.test(l));
    if (headerLineIdx !== -1) break;
  }

  if (headerLineIdx === -1) {
    warnings.push({ code: 'NO_TABLE_HEADER', message: 'Could not find transaction table header row.' });
    // Try heuristic: find lines that look like transaction rows
    return { transactions: parseTransactionHeuristic(lines, warnings), tableWarnings: warnings };
  }

  // Detect column positions from header line
  const headerLine = lines[headerLineIdx];
  const colMap = detectColumns(headerLine);

  // Parse rows after header
  for (let i = headerLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];

    // Stop at summary lines
    if (/total|closing\s+balance|opening\s+balance|grand\s+total/i.test(line)) break;
    // Skip separator lines
    if (/^[-=_|*\s]+$/.test(line)) continue;
    // Must contain a date-like pattern
    if (!/\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(line) && !/\d{1,2}\s+[A-Za-z]{3}\s+\d{4}/.test(line)) continue;

    const txn = parseTransactionRow(line, colMap, i);
    if (txn) transactions.push(txn);
  }

  return { transactions, tableWarnings: warnings };
}

function detectColumns(headerLine) {
  // Map column name patterns to positions
  const positions = {};
  const tokens = headerLine.split(/\s{2,}|\t/);
  let pos = 0;

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (/date/.test(lower)) positions.date = pos;
    else if (/narration|description|particulars|details/.test(lower)) positions.description = pos;
    else if (/debit|withdrawal|dr/.test(lower)) positions.debit = pos;
    else if (/credit|deposit|cr/.test(lower)) positions.credit = pos;
    else if (/balance/.test(lower)) positions.balance = pos;
    else if (/ref|id|chq|cheque/.test(lower)) positions.reference = pos;
    pos++;
  }

  return positions;
}

function parseTransactionRow(line, colMap, lineIdx) {
  // Date extraction
  const dateMatch = line.match(/(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{1,2}\s+[A-Za-z]{3}\s+\d{4})/);
  if (!dateMatch) return null;

  const date = normalizeDate(dateMatch[1]);
  if (!date) return null;

  // Amounts: look for currency-like patterns
  const amounts = [];
  const amtPattern = /([₹$]?\s*[\d,]+\.\d{2})/g;
  let m;
  while ((m = amtPattern.exec(line)) !== null) {
    amounts.push({ value: normalizeAmount(m[1]), index: m.index });
  }

  // Description: text between date and first amount
  const dateEnd = dateMatch.index + dateMatch[0].length;
  const firstAmtIdx = amounts[0]?.index ?? line.length;
  const description = line.slice(dateEnd, firstAmtIdx).trim().replace(/\s+/g, ' ');

  // Assign amounts based on position and context
  let debit = null, credit = null, balance = null, reference = null;

  if (amounts.length >= 3) {
    // Common format: debit, credit, balance
    debit = amounts[0].value || null;
    credit = amounts[1].value || null;
    balance = amounts[2].value || null;
  } else if (amounts.length === 2) {
    // Check context for debit/credit
    if (/dr|debit|withdrawal/i.test(line)) {
      debit = amounts[0].value;
      balance = amounts[1].value;
    } else if (/cr|credit|deposit/i.test(line)) {
      credit = amounts[0].value;
      balance = amounts[1].value;
    } else {
      debit = amounts[0].value;
      balance = amounts[1].value;
    }
  } else if (amounts.length === 1) {
    balance = amounts[0].value;
  }

  // Reference/transaction ID
  const refMatch = line.match(/(?:ref|txn|chq|utr)[:\s#]*([A-Z0-9]{8,20})/i);
  if (refMatch) reference = refMatch[1];

  return {
    date,
    description: description || null,
    debit,
    credit,
    balance,
    reference,
    _raw: line, // for debug
  };
}

function parseTransactionHeuristic(lines, warnings) {
  warnings.push({ code: 'HEURISTIC_PARSING', message: 'Using heuristic transaction parsing — accuracy may be reduced.' });
  const transactions = [];

  for (const line of lines) {
    const dateMatch = line.match(/(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/);
    if (!dateMatch) continue;
    const amounts = (line.match(/[\d,]+\.\d{2}/g) || []).map(a => normalizeAmount(a));
    if (amounts.length === 0) continue;

    transactions.push({
      date: normalizeDate(dateMatch[1]),
      description: line.slice(dateMatch.index + dateMatch[0].length).replace(/[\d,\.]+/g, '').trim() || null,
      debit: amounts[0] || null,
      credit: amounts[1] || null,
      balance: amounts[2] || null,
      reference: null,
    });
  }

  return transactions;
}

module.exports = { extractBankStatement };
