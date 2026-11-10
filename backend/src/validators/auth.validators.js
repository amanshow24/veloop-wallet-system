const httpError = require('../utils/httpError');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REGISTRATION_FIELDS = new Set(['name', 'email', 'password']);
const LOGIN_FIELDS = new Set(['email', 'password']);

function assertAllowedFields(body, allowedFields) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw httpError(400, 'A JSON object is required.');
  }

  const unexpectedField = Object.keys(body).find((field) => !allowedFields.has(field));
  if (unexpectedField) {
    throw httpError(400, `Unexpected field: ${unexpectedField}.`);
  }
}

function validateEmail(email) {
  return (
    typeof email === 'string' &&
    email.length <= 254 &&
    EMAIL_PATTERN.test(email.trim())
  );
}

function validatePassword(password) {
  return (
    typeof password === 'string' &&
    Buffer.byteLength(password, 'utf8') >= 8 &&
    Buffer.byteLength(password, 'utf8') <= 72
  );
}

function validateRegistration(req, _res, next) {
  try {
    const body = req.body;
    assertAllowedFields(body, REGISTRATION_FIELDS);

    if (typeof body.name !== 'string' || body.name.trim().length < 2 || body.name.trim().length > 80) {
      throw httpError(400, 'Name must be between 2 and 80 characters.');
    }
    if (!validateEmail(body.email)) {
      throw httpError(400, 'A valid email address is required.');
    }
    if (!validatePassword(body.password)) {
      throw httpError(400, 'Password must be between 8 and 72 UTF-8 bytes.');
    }

    req.validatedBody = {
      name: body.name.trim(),
      email: body.email.trim().toLowerCase(),
      password: body.password,
    };
    next();
  } catch (error) {
    next(error);
  }
}

function validateLogin(req, _res, next) {
  try {
    const body = req.body;
    assertAllowedFields(body, LOGIN_FIELDS);

    if (!validateEmail(body.email)) {
      throw httpError(400, 'A valid email address is required.');
    }
    if (!validatePassword(body.password)) {
      throw httpError(400, 'Email and password are required.');
    }

    req.validatedBody = {
      email: body.email.trim().toLowerCase(),
      password: body.password,
    };
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { validateLogin, validateRegistration };
