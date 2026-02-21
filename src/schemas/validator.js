'use strict';

const Ajv = require('ajv');
const ajv = new Ajv({ allErrors: true, strict: false });

// ── Base schema (shared fields) ──────────────────────────────────────────────
const baseSchema = {
  type: 'object',
  required: ['schema_version', 'document_id', 'document_type', 'processing', 'confidence'],
  properties: {
    schema_version: { type: 'string' },
    document_id: { type: 'string', format: 'uuid' },
    document_type: { type: 'string', enum: ['bank_statement', 'tax_statement', 'unknown'] },
    processing: {
      type: 'object',
      properties: {
        is_scanned: { type: 'boolean' },
        page_count: { type: 'integer', minimum: 1 },
        ocr_applied: { type: 'boolean' },
      },
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    warnings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
  },
};

// ── Bank Statement Schema ────────────────────────────────────────────────────
const bankSchema = {
  ...baseSchema,
  properties: {
    ...baseSchema.properties,
    header: {
      type: 'object',
      properties: {
        bank_name: { type: ['string', 'null'] },
        account_number: { type: ['string', 'null'] },
        account_holder_name: { type: ['string', 'null'] },
        account_type: { type: ['string', 'null'] },
        ifsc_code: { type: ['string', 'null'] },
        branch: { type: ['string', 'null'] },
        statement_period_from: { type: ['string', 'null'] },
        statement_period_to: { type: ['string', 'null'] },
        opening_balance: { type: ['number', 'null'] },
        closing_balance: { type: ['number', 'null'] },
        currency: { type: 'string' },
      },
    },
    transactions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['date'],
        properties: {
          date: { type: ['string', 'null'] },
          description: { type: ['string', 'null'] },
          debit: { type: ['number', 'null'] },
          credit: { type: ['number', 'null'] },
          balance: { type: ['number', 'null'] },
          reference: { type: ['string', 'null'] },
        },
      },
    },
  },
};

// ── Tax Statement Schema ─────────────────────────────────────────────────────
const taxSchema = {
  ...baseSchema,
  properties: {
    ...baseSchema.properties,
    header: {
      type: 'object',
      properties: {
        form_type: { type: ['string', 'null'] },
        assessment_year: { type: ['string', 'null'] },
        taxpayer_name: { type: ['string', 'null'] },
        pan: { type: ['string', 'null'] },
        taxpayer_address: { type: ['string', 'null'] },
        total_amount_paid_credited: { type: ['number', 'null'] },
        total_tax_deducted: { type: ['number', 'null'] },
        total_tds_deposited: { type: ['number', 'null'] },
      },
    },
    deductors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: ['string', 'null'] },
          tan: { type: ['string', 'null'] },
          pan: { type: ['string', 'null'] },
          total_amount_paid_credited: { type: ['number', 'null'] },
          total_tax_deducted: { type: ['number', 'null'] },
          total_tds_deposited: { type: ['number', 'null'] },
          transactions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                section: { type: ['string', 'null'] },
                transaction_date: { type: ['string', 'null'] },
                booking_date: { type: ['string', 'null'] },
                status_of_booking: { type: ['string', 'null'] },
                remarks: { type: ['string', 'null'] },
                amount_paid_credited: { type: ['number', 'null'] },
                tax_deducted: { type: ['number', 'null'] },
                tds_deposited: { type: ['number', 'null'] },
              },
            },
          },
        },
      },
    },
  },
};

const bankValidate = ajv.compile(bankSchema);
const taxValidate = ajv.compile(taxSchema);
const baseValidate = ajv.compile(baseSchema);

function validateResult(result, documentType) {
  let validate;
  if (documentType === 'bank_statement') validate = bankValidate;
  else if (documentType === 'tax_statement') validate = taxValidate;
  else validate = baseValidate;

  const valid = validate(result);
  const errors = (validate.errors || []).map(e => `${e.instancePath} ${e.message}`);
  return { valid, errors };
}

// Export schemas for documentation
const schemas = {
  bank_statement: bankSchema,
  tax_statement: taxSchema,
};

module.exports = { validateResult, schemas };
