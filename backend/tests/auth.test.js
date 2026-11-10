process.env.JWT_SECRET = 'test-only-secret-that-is-at-least-32-characters-long';

const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const express = require('express');
const { once } = require('node:events');
const mongoose = require('mongoose');
const test = require('node:test');
const app = require('../src/app');
const User = require('../src/models/User');
const Wallet = require('../src/models/Wallet');
const authenticate = require('../src/middleware/authenticate');
const authorizeRoles = require('../src/middleware/authorize');
const { errorHandler } = require('../src/middleware/errorHandler');
const { createToken } = require('../src/controllers/auth.controller');

async function withServer(serverApp, callback) {
  const server = serverApp.listen(0);
  await once(server, 'listening');

  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function makeUser(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    name: 'Test User',
    email: 'test@example.com',
    passwordHash: '$2b$12$test-hash',
    accountStatus: 'ACTIVE',
    role: 'USER',
    comparePassword: async (password) => password === 'correct-password',
    ...overrides,
  };
}

test('registration creates a user with a bcrypt hash and returns a JWT', async (t) => {
  let savedUser;
  let savedWallet;
  const session = {
    withTransaction: async (callback) => callback(),
    endSession: async () => {},
  };
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(User.prototype, 'save', async function save(options) {
    assert.equal(options.session, session);
    savedUser = this;
    return this;
  });
  t.mock.method(Wallet.prototype, 'save', async function save(options) {
    assert.equal(options.session, session);
    savedWallet = this;
    return this;
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Test User',
        email: ' TEST@EXAMPLE.COM ',
        password: 'correct-password',
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.success, true);
    assert.equal(body.user.email, 'test@example.com');
    assert.equal(body.user.role, 'USER');
    assert.equal(body.user.passwordHash, undefined);
    assert.equal(body.user.password, undefined);
    assert.ok(body.token);
    assert.ok(savedUser.passwordHash.startsWith('$2b$12$'));
    assert.equal(await bcrypt.compare('correct-password', savedUser.passwordHash), true);
    assert.equal(savedWallet.userId.toString(), savedUser._id.toString());
    assert.deepEqual(
      ['ves', 'sves', 'gems', 'tokens', 'spins'].map((currency) => savedWallet[currency]),
      [0, 0, 0, 0, 0],
    );
  });
});

test('duplicate email registration returns conflict and does not create a wallet', async (t) => {
  const session = {
    withTransaction: async (callback) => callback(),
    endSession: async () => {},
  };
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(User.prototype, 'save', async () => {
    const error = new Error('Duplicate email index.');
    error.code = 11000;
    throw error;
  });
  const saveWallet = t.mock.method(Wallet.prototype, 'save', async () => {
    throw new Error('Wallet should not be created for duplicate registration.');
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Test User',
        email: 'duplicate@example.com',
        password: 'correct-password',
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.equal(body.message, 'An account with this email already exists.');
    assert.equal(saveWallet.mock.callCount(), 0);
  });
});

test('registration rejects attempts to set privileged fields', async () => {
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Test User',
        email: 'test@example.com',
        password: 'correct-password',
        role: 'ADMIN',
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(body.message, /Unexpected field: role/);
  });
});

test('registration rejects invalid name, email, and password before persistence', async (t) => {
  const { validateRegistration } = require('../src/validators/auth.validators');
  const cases = [
    { name: 'A', email: 'valid@example.com', password: 'correct-password' },
    { name: 'Valid Name', email: 'not-an-email', password: 'correct-password' },
    { name: 'Valid Name', email: 'valid@example.com', password: 'short' },
  ];

  const saveUser = t.mock.method(User.prototype, 'save', async () => {
    throw new Error('Invalid registration reached user persistence.');
  });
  const response = await fetchRegistration(cases[0]);
  assert.equal(response.status, 400);

  for (const body of cases) {
    let validationError;
    validateRegistration(
      { body },
      {},
      (error) => {
        validationError = error;
      },
    );
    assert.equal(validationError.statusCode, 400);
  }
  assert.equal(saveUser.mock.callCount(), 0);
});

async function fetchRegistration(body) {
  let response;
  await withServer(app, async (baseUrl) => {
    response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  });
  return response;
}

test('login accepts valid credentials and rejects invalid credentials', async (t) => {
  const user = makeUser();
  t.mock.method(User, 'findOne', () => ({
    select: async () => user,
  }));

  await withServer(app, async (baseUrl) => {
    const successfulResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'TEST@example.com',
        password: 'correct-password',
      }),
    });

    const successfulBody = await successfulResponse.json();

    assert.equal(successfulResponse.status, 200);
    assert.equal(successfulBody.user.id, user._id.toString());
    assert.ok(successfulBody.token);

    const failedResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'wrong-password',
      }),
    });
    const failedBody = await failedResponse.json();

    assert.equal(failedResponse.status, 401);
    assert.equal(failedBody.message, 'Invalid email or password.');
  });
});

test('expired JWTs cannot access authenticated routes', async () => {
  const jwt = require('jsonwebtoken');
  const expiredToken = jwt.sign({}, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: new mongoose.Types.ObjectId().toString(),
    audience: 'veloop-wallet-client',
    issuer: 'veloop-wallet-api',
    expiresIn: -1,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.message, 'Invalid or expired authentication token.');
  });
});

test('login rejects suspended accounts', async (t) => {
  const user = makeUser({ accountStatus: 'SUSPENDED' });
  t.mock.method(User, 'findOne', () => ({
    select: async () => user,
  }));

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: user.email,
        password: 'correct-password',
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.message, 'Account is not active.');
    assert.equal(body.token, undefined);
  });
});

test('the current-user route requires a token and uses the token identity', async (t) => {
  const user = makeUser();
  t.mock.method(User, 'findById', async (id) => {
    assert.equal(id, user._id.toString());
    return user;
  });

  await withServer(app, async (baseUrl) => {
    const anonymousResponse = await fetch(`${baseUrl}/api/auth/me`);
    assert.equal(anonymousResponse.status, 401);

    const response = await fetch(`${baseUrl}/api/auth/me?userId=another-user`, {
      headers: { authorization: `Bearer ${createToken(user._id.toString())}` },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.user.id, user._id.toString());
    assert.equal(body.user.email, user.email);
    assert.equal(body.user.passwordHash, undefined);
  });
});

test('authorization middleware restricts internal routes by persisted role', async (t) => {
  const user = makeUser({ role: 'USER' });
  t.mock.method(User, 'findById', async () => user);

  const protectedApp = express();
  protectedApp.get(
    '/internal',
    authenticate,
    authorizeRoles('ADMIN'),
    (_req, res) => res.status(200).json({ success: true }),
  );
  protectedApp.use(errorHandler);

  await withServer(protectedApp, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal`, {
      headers: { authorization: `Bearer ${createToken(user._id.toString())}` },
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.message, 'You are not authorized to perform this action.');
  });
});
