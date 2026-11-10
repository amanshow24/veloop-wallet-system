const httpError = require('../utils/httpError');
const { validateEmptyQuery } = require('./wallet.validators');

const ID_PATTERN = /^[a-z][a-z0-9_]{1,39}$/i;
const OPTION_PATTERN = /^[a-z][a-z0-9_]{1,127}$/i;
const WITHDRAWAL_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateCreateWithdrawal(req, _res, next) {
  try {
    const body = req.body;
    if (!isPlainObject(body)) {
      throw httpError(400, 'A JSON object is required.');
    }

    const unexpectedField = Object.keys(body).find(
      (field) => !['method', 'optionId', 'payoutDetails'].includes(field),
    );
    if (unexpectedField) {
      throw httpError(400, `Unexpected request field: ${unexpectedField}.`);
    }
    if (typeof body.method !== 'string' || !ID_PATTERN.test(body.method.trim())) {
      throw httpError(400, 'A valid payout method ID is required.');
    }
    if (typeof body.optionId !== 'string' || !OPTION_PATTERN.test(body.optionId.trim())) {
      throw httpError(400, 'A valid payout option ID is required.');
    }
    if (!isPlainObject(body.payoutDetails)) {
      throw httpError(400, 'payoutDetails must be a JSON object.');
    }

    const idempotencyKey = req.get('Idempotency-Key');
    if (
      typeof idempotencyKey !== 'string' ||
      !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey.trim())
    ) {
      throw httpError(400, 'A valid Idempotency-Key header is required.');
    }

    req.validatedBody = {
      methodId: body.method.trim().toLowerCase(),
      optionId: body.optionId.trim().toLowerCase(),
      payoutDetails: body.payoutDetails,
      idempotencyKey: idempotencyKey.trim(),
    };
    next();
  } catch (error) {
    next(error);
  }
}

function validateWithdrawalListQuery(req, _res, next) {
  try {
    const unexpectedField = Object.keys(req.query).find(
      (field) => !['page', 'limit', 'status'].includes(field),
    );
    if (unexpectedField) {
      throw httpError(400, `Unexpected query field: ${unexpectedField}.`);
    }

    const parsePositiveInteger = (value, name, defaultValue, maximum) => {
      if (value === undefined) {
        return defaultValue;
      }
      if (
        typeof value !== 'string' ||
        !/^\d+$/.test(value) ||
        !Number.isSafeInteger(Number(value)) ||
        Number(value) < 1 ||
        Number(value) > maximum
      ) {
        throw httpError(400, `Invalid withdrawal ${name}.`);
      }
      return Number(value);
    };

    let status;
    if (req.query.status !== undefined) {
      if (
        typeof req.query.status !== 'string' ||
        !['PENDING', 'PROCESSING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(
          req.query.status.trim().toUpperCase(),
        )
      ) {
        throw httpError(400, 'Unsupported withdrawal status.');
      }
      status = req.query.status.trim().toUpperCase();
    }

    req.validatedQuery = {
      page: parsePositiveInteger(req.query.page, 'page', 1, 1000000),
      limit: parsePositiveInteger(req.query.limit, 'limit', 20, 100),
      ...(status ? { status } : {}),
    };
    next();
  } catch (error) {
    next(error);
  }
}

function validateWithdrawalId(req, _res, next) {
  if (
    typeof req.params.withdrawalId !== 'string' ||
    !WITHDRAWAL_ID_PATTERN.test(req.params.withdrawalId)
  ) {
    return next(httpError(400, 'A valid withdrawal ID is required.'));
  }
  next();
}

function validateTransition(action) {
  return (req, _res, next) => {
    try {
      if (!isPlainObject(req.body)) {
        throw httpError(400, 'A JSON object is required.');
      }
      const permittedFields = action === 'reject' ? ['reason'] : ['reviewNote'];
      const unexpectedField = Object.keys(req.body).find(
        (field) => !permittedFields.includes(field),
      );
      if (unexpectedField) {
        throw httpError(400, `Unexpected request field: ${unexpectedField}.`);
      }

      const field = action === 'reject' ? 'reason' : 'reviewNote';
      const value = req.body[field];
      if (
        value !== undefined &&
        (typeof value !== 'string' ||
          value.trim().length < 3 ||
          value.trim().length > 1000)
      ) {
        throw httpError(400, `${field} must be between 3 and 1000 characters.`);
      }
      if (action === 'reject' && value === undefined) {
        throw httpError(400, 'A rejection reason is required.');
      }

      req.validatedBody = value === undefined ? {} : { [field]: value.trim() };
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  validateCreateWithdrawal,
  validateEmptyQuery,
  validateTransition,
  validateWithdrawalId,
  validateWithdrawalListQuery,
};
