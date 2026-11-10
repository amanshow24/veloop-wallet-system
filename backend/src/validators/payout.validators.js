const httpError = require('../utils/httpError');
const { validateEmptyQuery } = require('./wallet.validators');

function validateOptionsQuery(req, _res, next) {
  try {
    const fields = Object.keys(req.query);
    const unexpectedField = fields.find((field) => field !== 'method');
    if (unexpectedField) {
      throw httpError(400, `Unexpected query field: ${unexpectedField}.`);
    }

    if (req.query.method !== undefined && typeof req.query.method !== 'string') {
      throw httpError(400, 'method must be a single payout method ID.');
    }
    if (
      typeof req.query.method === 'string' &&
      !/^[a-z][a-z0-9_]{1,39}$/i.test(req.query.method.trim())
    ) {
      throw httpError(400, 'Invalid payout method ID.');
    }

    req.validatedQuery = req.query.method
      ? { methodId: req.query.method.trim().toLowerCase() }
      : {};
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { validateEmptyQuery, validateOptionsQuery };
