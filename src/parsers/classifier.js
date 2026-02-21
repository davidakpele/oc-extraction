'use strict';

/**
 * Classify a document as 'bank_statement', 'tax_statement', or 'unknown'
 * based on keyword scoring of the extracted text.
 */

const BANK_KEYWORDS = [
  { pattern: /bank\s+statement/i, weight: 5 },
  { pattern: /account\s+(number|no\.?|#)/i, weight: 4 },
  { pattern: /opening\s+balance/i, weight: 5 },
  { pattern: /closing\s+balance/i, weight: 5 },
  { pattern: /transaction\s+(date|id|ref)/i, weight: 3 },
  { pattern: /debit/i, weight: 3 },
  { pattern: /credit/i, weight: 2 },
  { pattern: /available\s+balance/i, weight: 4 },
  { pattern: /statement\s+period/i, weight: 4 },
  { pattern: /IFSC|swift\s+code/i, weight: 4 },
  { pattern: /account\s+type/i, weight: 3 },
  { pattern: /running\s+balance/i, weight: 4 },
  { pattern: /narration|description/i, weight: 2 },
  { pattern: /passbook/i, weight: 4 },
  { pattern: /savings\s+account|current\s+account/i, weight: 3 },
];

const TAX_KEYWORDS = [
  { pattern: /form\s+(26as|16|16a)/i, weight: 6 },
  { pattern: /tax\s+deducted\s+at\s+source|TDS/i, weight: 6 },
  { pattern: /income\s+tax/i, weight: 4 },
  { pattern: /deductor/i, weight: 6 },
  { pattern: /PAN\s+(of\s+)?(deductee|deductor)/i, weight: 5 },
  { pattern: /TAN/i, weight: 4 },
  { pattern: /section\s+\d+[A-Z]?/i, weight: 3 },
  { pattern: /status\s+of\s+booking/i, weight: 5 },
  { pattern: /total\s+tax\s+deducted/i, weight: 5 },
  { pattern: /TDS\s+deposited/i, weight: 5 },
  { pattern: /amount\s+paid.*credited/i, weight: 4 },
  { pattern: /date\s+of\s+booking/i, weight: 4 },
  { pattern: /traces|NSDL/i, weight: 4 },
  { pattern: /assessment\s+year/i, weight: 5 },
];

function scoreText(text, keywords) {
  return keywords.reduce((score, { pattern, weight }) => {
    const matches = (text.match(pattern) || []).length;
    return score + Math.min(matches, 2) * weight; // cap each keyword at 2x
  }, 0);
}

function classifyDocument(text, filename = '') {
  const bankScore = scoreText(text, BANK_KEYWORDS);
  const taxScore = scoreText(text, TAX_KEYWORDS);

  // Filename hints
  const fn = (filename || '').toLowerCase();
  const bankBonus = /bank|statement|passbook/.test(fn) ? 10 : 0;
  const taxBonus = /26as|tds|tax|form16/.test(fn) ? 10 : 0;

  const totalBank = bankScore + bankBonus;
  const totalTax = taxScore + taxBonus;

  const maxScore = Math.max(totalBank, totalTax);
  const minThreshold = 8;

  if (maxScore < minThreshold) {
    return { documentType: 'unknown', confidence: 0 };
  }

  const documentType = totalBank >= totalTax ? 'bank_statement' : 'tax_statement';
  const winnerScore = documentType === 'bank_statement' ? totalBank : totalTax;
  const loserScore = documentType === 'bank_statement' ? totalTax : totalBank;

  // Confidence: how decisive the classification is
  const confidence = Math.min(0.99, (winnerScore / (winnerScore + loserScore + 1)));

  return { documentType, confidence: Math.round(confidence * 100) / 100, bankScore: totalBank, taxScore: totalTax };
}

module.exports = { classifyDocument };
