process.env.JWT_SECRET = 'test-only-secret-that-is-at-least-32-characters-long';

const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const mongoose = require('mongoose');
const test = require('node:test');
const User = require('../src/models/User');
const { createToken } = require('../src/controllers/auth.controller');
const { errorHandler, notFoundHandler } = require('../src/middleware/errorHandler');
const withdrawalRoutes = require('../src/routes/withdrawal.routes');
const withdrawalService = require('../src/services/withdrawalService');

const userId = new mongoose.Types.ObjectId();
const otherUserId = new mongoose.Types.ObjectId();
const adminId = new mongoose.Types.ObjectId();
const withdrawalId = 'c0d0f9fc-9898-4e16-a3d0-96083f1ac91f';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/withdrawals', withdrawalRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

async function withServer(app, callback) {
  const server = app.listen(0);
  await once(server, 'listening');
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function authHeaders(id = userId) {
  return { authorization: `Bearer ${createToken(id.toString())}` };
}

function authenticatedUserFor(id) {
  return {
    _id: new mongoose.Types.ObjectId(id),
    role: id === adminId.toString() ? 'ADMIN' : 'USER',
    accountStatus: 'ACTIVE',
  };
}

test('withdrawal routes require authentication', async () => {
  await withServer(createTestApp(), async (baseUrl) => {
    for (const [method, path] of [
      ['POST', '/api/withdrawals'],
      ['GET', '/api/withdrawals'],
      ['GET', `/api/withdrawals/${withdrawalId}`],
    ]) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      assert.equal(response.status, 401, `${method} ${path}`);
    }
  });
});

test('create validates exact request fields and derives identity from JWT', async (t) => {
  const app = createTestApp();
  let captured;
  const create = t.mock.method(withdrawalService, 'createWithdrawal', async (options) => {
    captured = options;
    return {
      replayed: false,
      withdrawal: {
        withdrawalId,
        userId,
        method: 'upi',
        optionId: 'upi_inr_10',
        currency: 'VES',
        currencyAmount: 2400,
        payoutAmount: 10,
        payoutCurrency: 'INR',
        payoutDetails: { upiId: 'demo@upi' },
        status: 'PENDING',
        statusHistory: [],
      },
    };
  });
  t.mock.method(User, 'findById', async (id) => authenticatedUserFor(id));

  await withServer(app, async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/withdrawals`, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'content-type': 'application/json',
        'Idempotency-Key': 'request-123456',
      },
      body: JSON.stringify({
        method: 'upi',
        optionId: 'upi_inr_10',
        payoutDetails: { upiId: 'demo@upi' },
        amount: 1,
      }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(create.mock.callCount(), 0);

    const response = await fetch(`${baseUrl}/api/withdrawals/`, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'content-type': 'application/json',
        'Idempotency-Key': 'request-123456',
      },
      body: JSON.stringify({
        method: 'upi',
        optionId: 'upi_inr_10',
        payoutDetails: { upiId: 'demo@upi' },
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.withdrawal.withdrawalId, withdrawalId);
    assert.equal(body.withdrawal.payoutCurrency, 'INR');
    assert.equal(captured.userId, userId.toString());
    assert.equal(captured.actorId, userId.toString());
    assert.equal(captured.idempotencyKey, 'request-123456');
    assert.equal(captured.amount, undefined);
  });
});

test('withdrawal list and detail are scoped to authenticated identity', async (t) => {
  const app = createTestApp();
  const list = t.mock.method(withdrawalService, 'getWithdrawals', async (options) => {
    assert.equal(options.userId, userId.toString());
    return { withdrawals: [{ withdrawalId, userId, status: 'PENDING' }], pagination: { page: 1 } };
  });
  const get = t.mock.method(withdrawalService, 'getWithdrawal', async (options) => {
    assert.equal(options.userId, userId.toString());
    if (options.withdrawalId === 'other-user-request') {
      const error = new Error('Withdrawal not found.');
      error.statusCode = 404;
      throw error;
    }
    return { withdrawalId, userId, status: 'PENDING' };
  });
  t.mock.method(User, 'findById', async (id) => authenticatedUserFor(id));

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/withdrawals/?page=1&limit=5`, {
      headers: authHeaders(),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).withdrawals[0].withdrawalId, withdrawalId);

    const foreign = await fetch(`${baseUrl}/api/withdrawals/other-user-request`, {
      headers: authHeaders(),
    });
    assert.equal(foreign.status, 404);
    assert.equal((await foreign.json()).message, 'Withdrawal not found.');

    const invalidQuery = await fetch(
      `${baseUrl}/api/withdrawals?userId=${otherUserId.toString()}`,
      { headers: authHeaders() },
    );
    assert.equal(invalidQuery.status, 400);
    assert.equal(list.mock.callCount(), 1);
    assert.equal(get.mock.callCount(), 1);
  });
});

test('only admin/internal users may process, approve, or reject withdrawals', async (t) => {
  const app = createTestApp();
  const transition = t.mock.method(withdrawalService, 'transitionWithdrawal', async (options) => ({
    withdrawalId: options.withdrawalId,
    userId,
    status: options.action === 'reject' ? 'REJECTED' : 'PROCESSING',
  }));
  t.mock.method(User, 'findById', async (id) => authenticatedUserFor(id));

  await withServer(app, async (baseUrl) => {
    const denied = await fetch(`${baseUrl}/api/withdrawals/${withdrawalId}/process`, {
      method: 'PATCH',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(denied.status, 403);
    assert.equal(transition.mock.callCount(), 0);

    const adminHeaders = {
      ...authHeaders(adminId),
      'content-type': 'application/json',
    };
    for (const [operation, body] of [
      ['process', {}],
      ['approve', { reviewNote: 'Payment confirmed.' }],
      ['reject', { reason: 'Payout details could not be verified.' }],
    ]) {
      const response = await fetch(`${baseUrl}/api/withdrawals/${withdrawalId}/${operation}`, {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 200, operation);
    }
    assert.deepEqual(
      transition.mock.calls.map((call) => call.arguments[0].action),
      ['process', 'approve', 'reject'],
    );
    assert.equal(transition.mock.calls[2].arguments[0].reason, 'Payout details could not be verified.');
  });
});

test('admin transition validators reject malformed bodies and require a rejection reason', async (t) => {
  const app = createTestApp();
  const transition = t.mock.method(withdrawalService, 'transitionWithdrawal', async () => {
    throw new Error('Invalid review request reached the service.');
  });
  t.mock.method(User, 'findById', async (id) => authenticatedUserFor(id));

  await withServer(app, async (baseUrl) => {
    for (const [operation, body] of [
      ['process', { userId: otherUserId.toString() }],
      ['approve', { reviewNote: '' }],
      ['reject', {}],
    ]) {
      const response = await fetch(`${baseUrl}/api/withdrawals/${withdrawalId}/${operation}`, {
        method: 'PATCH',
        headers: {
          ...authHeaders(adminId),
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400, operation);
    }
    assert.equal(transition.mock.callCount(), 0);
  });
});
