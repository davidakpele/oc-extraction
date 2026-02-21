'use strict';

const { normalizeDate, normalizeAmount, calcConfidence } = require('../src/utils/normalize');
const { classifyDocument } = require('../src/parsers/classifier');

// ── normalize.js tests ────────────────────────────────────────────────────────
describe('normalizeDate', () => {
  test('parses dd/MM/yyyy', () => {
    expect(normalizeDate('15/03/2024')).toBe('2024-03-15');
  });
  test('parses dd-MMM-yyyy', () => {
    expect(normalizeDate('15-Mar-2024')).toBe('2024-03-15');
  });
  test('parses dd MMM yyyy', () => {
    expect(normalizeDate('15 Mar 2024')).toBe('2024-03-15');
  });
  test('parses yyyy-MM-dd (ISO)', () => {
    expect(normalizeDate('2024-03-15')).toBe('2024-03-15');
  });
  test('returns null for garbage', () => {
    expect(normalizeDate('not a date')).toBeNull();
  });
  test('returns null for empty string', () => {
    expect(normalizeDate('')).toBeNull();
  });
  test('returns null for null', () => {
    expect(normalizeDate(null)).toBeNull();
  });
});

describe('normalizeAmount', () => {
  test('parses simple float', () => {
    expect(normalizeAmount('1234.56')).toBe(1234.56);
  });
  test('strips commas', () => {
    expect(normalizeAmount('1,23,456.78')).toBe(123456.78);
  });
  test('strips INR symbol', () => {
    expect(normalizeAmount('₹ 5,000.00')).toBe(5000);
  });
  test('handles negative parentheses', () => {
    expect(normalizeAmount('(1,500.00)')).toBe(-1500);
  });
  test('handles negative dash', () => {
    expect(normalizeAmount('-750.50')).toBe(-750.50);
  });
  test('returns null for text', () => {
    expect(normalizeAmount('N/A')).toBeNull();
  });
  test('returns null for empty', () => {
    expect(normalizeAmount('')).toBeNull();
  });
});

describe('calcConfidence', () => {
  test('returns 1 when all required fields filled', () => {
    const fields = { a: 'value', b: 'value' };
    expect(calcConfidence(fields, ['a', 'b'])).toBe(1);
  });
  test('returns partial confidence when some required fields missing', () => {
    const fields = { a: 'value', b: null };
    const conf = calcConfidence(fields, ['a', 'b']);
    expect(conf).toBeLessThan(1);
    expect(conf).toBeGreaterThan(0);
  });
  test('returns 0 for empty fields', () => {
    expect(calcConfidence({}, [])).toBe(0);
  });
});

// ── classifier.js tests ───────────────────────────────────────────────────────
describe('classifyDocument', () => {
  const bankText = `
    State Bank of India - Account Statement
    Account Number: 12345678901
    Statement Period: 01/01/2024 to 31/03/2024
    Opening Balance: 25,430.50
    Closing Balance: 48,250.75
    Date | Description | Debit | Credit | Balance
    01/01/2024 | SALARY CREDIT | | 55,000.00 | 80,430.50
    05/01/2024 | RENT PAYMENT | 22,000.00 | | 58,430.50
  `;

  const taxText = `
    FORM 26AS - Annual Tax Statement
    Assessment Year: 2024-25
    PAN of Taxpayer: ABCDE1234F
    Name of Deductor: XYZ Technologies Pvt Ltd
    TAN: MUMX12345A
    Section: 192 | Transaction Date: 30/04/2024 | TDS Deposited: 5,500.00
    Total Tax Deducted: 66,000.00
    Total TDS Deposited: 66,000.00
    Status of Booking: F | Date of Booking: 07/05/2024
  `;

  test('classifies bank statement correctly', () => {
    const result = classifyDocument(bankText, 'bank_statement.pdf');
    expect(result.documentType).toBe('bank_statement');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  test('classifies tax statement correctly', () => {
    const result = classifyDocument(taxText, 'form26as.pdf');
    expect(result.documentType).toBe('tax_statement');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  test('returns unknown for generic text', () => {
    const result = classifyDocument('Hello world, this is just some text.', 'random.pdf');
    expect(result.documentType).toBe('unknown');
  });

  test('uses filename hint for bank', () => {
    const result = classifyDocument('Some financial document content with account details and debit credit entries for a statement period.', 'bank_statement_march.pdf');
    expect(result.documentType).toBe('bank_statement');
  });

  test('uses filename hint for tax', () => {
    const result = classifyDocument('Tax information with PAN and TDS details and deductor name and section details.', '26AS_2024.pdf');
    expect(result.documentType).toBe('tax_statement');
  });
});
