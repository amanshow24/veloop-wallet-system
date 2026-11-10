const mongoose = require('mongoose');
const { TRANSACTION_TYPES, WALLET_CURRENCIES } = require('../models/constants');
const { isPlainObject } = require('../models/schemaFields');
const httpError = require('../utils/httpError');

const MUTATION_FIELDS = new Set([
  'targetUserId',
  'currency',
  'amount',
  'type',
  'source',
  'referenceId',
  'description',
  'metadata',
]);
const TRANSACTION_TYPES_BY_OPERATION = {
  credit: new Set([
    'CREDIT',
    'REWARD',
    'BONUS',
    'REFERRAL',
    'DAILY_REWARD',
    'AD_REWARD',
    'GAME_REWARD',
    'ADMIN_CREDIT',
    'EXCHANGE_CREDIT',
  ]),
  debit: new Set([
    'DEBIT',
    'WITHDRAWAL',
    'EXCHANGE_DEBIT',
    'ADMIN_DEBIT',
    'CORRECTION',
  ]),
};
const ALLOWED_QUERY_FIELDS = new Set(['page', 'limit']);

function assertExactFields(value, allowedFields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw httpError(400, `${label} must be a JSON object.`);
  }
  const unexpectedField = Object.keys(value).find((field) => !allowedFields.has(field));
  if (unexpectedField) {
    throw httpError(400, `Unexpected ${label.toLowerCase()} field: ${unexpectedField}.`);
  }
}

function parseInteger(value, name, { defaultValue, maximum }) {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw httpError(400, `${name} must be a positive integer.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw httpError(400, `${name} must be between 1 and ${maximum}.`);
  }
  return parsed;
}

function validateTransactionQuery(req, _res, next) {
  try {
    assertExactFields(req.query, ALLOWED_QUERY_FIELDS, 'Query');
    req.validatedQuery = {
      page: parseInteger(req.query.page, 'page', { defaultValue: 1, maximum: 1000000 }),
      limit: parseInteger(req.query.limit, 'limit', { defaultValue: 20, maximum: 100 }),
    };
    next();
  } catch (error) {
    next(error);
  }
}

function validateEmptyQuery(req, _res, next) {
  try {
    assertExactFields(req.query, new Set(), 'Query');
    next();
  } catch (error) {
    next(error);
  }
}

function validateMutation(operation) {
  return (req, _res, next) => {
    try {
      assertExactFields(req.body, MUTATION_FIELDS, 'Request');
      const { targetUserId, currency, amount, type, source, referenceId, description, metadata } =
        req.body;

      if (!mongoose.isObjectIdOrHexString(targetUserId)) {
        throw httpError(400, 'A valid targetUserId is required.');
      }
      if (typeof currency !== 'string' || !WALLET_CURRENCIES.includes(currency.trim().toUpperCase())) {
        throw httpError(400, 'Unsupported wallet currency.');
      }
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw httpError(400, 'Amount must be a positive safe integer.');
      }
      if (typeof type !== 'string') {
        throw httpError(400, `A valid ${operation} transaction type is required.`);
      }
      const normalizedType = type.trim().toUpperCase();
      if (
        !TRANSACTION_TYPES.includes(normalizedType) ||
        !TRANSACTION_TYPES_BY_OPERATION[operation].has(normalizedType)
      ) {
        throw httpError(400, `Transaction type is not valid for a wallet ${operation}.`);
      }
      if (typeof source !== 'string' || source.trim().length === 0 || source.trim().length > 64) {
        throw httpError(400, 'Transaction source must be between 1 and 64 characters.');
      }
      if (
        typeof description !== 'string' ||
        description.trim().length === 0 ||
        description.trim().length > 300
      ) {
        throw httpError(400, 'Transaction description must be between 1 and 300 characters.');
      }
      if (
        referenceId !== undefined &&
        referenceId !== null &&
        (typeof referenceId !== 'string' || referenceId.trim().length > 128)
      ) {
        throw httpError(400, 'Transaction reference ID must be at most 128 characters.');
      }
      if (metadata !== undefined && !isPlainObject(metadata)) {
        throw httpError(400, 'Transaction metadata must be a plain object.');
      }

      req.validatedBody = {
        targetUserId,
        currency: currency.trim().toUpperCase(),
        amount,
        type: normalizedType,
        source: source.trim(),
        ...(referenceId === undefined ? {} : { referenceId }),
        description: description.trim(),
        ...(metadata === undefined ? {} : { metadata }),
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { validateEmptyQuery, validateMutation, validateTransactionQuery };
