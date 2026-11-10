process.env.JWT_SECRET = 'test-only-secret-that-is-at-least-32-characters-long';

const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const mongoose = require('mongoose');
const test = require('node:test');
const User = require('../src/models/User');
const walletService = require('../src/services/walletService');
const { createToken } = require('../src/controllers/auth.controller');
const { errorHandler, notFoundHandler } = require('../src/middleware/errorHandler');
const walletRoutes = require('../src/routes/wallet.routes');

const normalUserId = new mongoose.Types.ObjectId();
const otherUserId = new mongoose.Types.ObjectId();
const adminUserId = new mongoose.Types.ObjectId();
const testWallet = {
  _id: new mongoose.Types.ObjectId(),
  ves: 25000,
  sves: 5000,
  gems: 100,
  tokens: 500,
  spins: 3,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-02-01T00:00:00.000Z'),
};

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/wallet', walletRoutes);
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

function tokenFor(userId) {
  return createToken(userId.toString());
}

function authHeaders(token) {
  return { authorization: `Bearer ${token}` };
}

function authenticatedUserFor(id) {
  const roles = new Map([
    [normalUserId.toString(), 'USER'],
    [adminUserId.toString(), 'ADMIN'],
  ]);
  return {
    _id: new mongoose.Types.ObjectId(id),
    role: roles.get(id) || 'USER',
    accountStatus: 'ACTIVE',
  };
}

test('all wallet endpoints require a valid authenticated user', async (t) => {
  const app = createTestApp();
  t.mock.method(User, 'findById', async (id) => authenticatedUserFor(id));

  await withServer(app, async (baseUrl) => {
    const requests = [
      ['GET', '/api/wallet'],
      ['GET', '/api/wallet/summary'],
      ['GET', '/api/wallet/transactions?page=1&limit=20'],
      ['POST', '/api/wallet/credit'],
      ['POST', '/api/wallet/debit'],
    ];

    for (const [method, path] of requests) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      const body = await response.json();

      assert.equal(response.status, 401, `${method} ${path}`);
      assert.deepEqual(body, { success: false, message: 'Authentication required.' });
    }
  });
});

test('GET wallet and summary use only the authenticated identity', async (t) => {
  const app = createTestApp();
  const getWallet = t.mock.method(walletService, 'getWallet', async (userId) => {
    assert.equal(userId, normalUserId.toString());
    return testWallet;
  });
  t.mock.method(User, 'findById', async (id) => authenticatedUserFor(id));

  await withServer(app, async (baseUrl) => {
    const token = tokenFor(normalUserId);
    const walletResponse = await fetch(`${baseUrl}/api/wallet`, {
      headers: authHeaders(token),
    });
    const walletBody = await walletResponse.json();

    assert.equal(walletResponse.status, 200);
    assert.deepEqual(walletBody, {
      success: true,
      wallet: {
        id: testWallet._id.toString(),
        ves: 25000,
        sves: 5000,
        gems: 100,
        tokens: 500,
        spins: 3,
        createdAt: testWallet.createdAt.toISOString(),
        updatedAt: testWallet.updatedAt.toISOString(),
      },
    });

    const summaryResponse = await fetch(`${baseUrl}/api/wallet/summary`, {
      headers: authHeaders(token),
    });
    const summaryBody = await summaryResponse.json();
    assert.equal(summaryResponse.status, 200);
    assert.deepEqual(summaryBody.summary.balances, {
      ves: 25000,
      sves: 5000,
      gems: 100,
      tokens: 500,
      spins: 3,
    });
    assert.equal(getWallet.mock.callCount(), 2);
  });
});

test('normal user cannot use query parameters to read another user wallet', async (t) => {
  const app = createTestApp();
  const getWallet = t.mock.method(walletService, 'getWallet', async () => testWallet);
  t.mock.method(User, 'findById', async (id) => authenticatedUserFor(id));

  await withServer(app, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/wallet?userId=${otherUserId.toString()}`,
      { headers: authHeaders(tokenFor(normalUserId)) },
    );
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.success, false);
    assert.match(body.message, /Unexpected query field: userId/);
    assert.equal(getWallet.mock.callCount(), 0);
  });
});

test('transaction history supports pagination and rejects invalid query fields', async (t) => {
  const app = createTestApp();
  let capturedOptions;
  t.mock.method(walletService, 'getTransactions', async (options) => {
    capturedOptions = options;
    return {
      transactions: [{ transactionId: 'tx-1', amount: 100 }],
      pagination: { page: 2, limit: 5, total: 6, pages: 2 },
    };
  });
  t.mock.method(User, 'findById', async (id) => authenticatedUserFor(id));

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/wallet/transactions?page=2&limit=5`, {
      headers: authHeaders(tokenFor(normalUserId)),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(capturedOptions, { userId: normalUserId.toString(), page: 2, limit: 5 });
    assert.deepEqual(body, {
      success: true,
      transactions: [{ transactionId: 'tx-1', amount: 100 }],
      pagination: { page: 2, limit: 5, total: 6, pages: 2 },
    });

    for (const query of ['page=0', 'page=1.5', 'limit=101', 'page=1&page=2', `userId=${otherUserId}`]) {
      const invalidResponse = await fetch(`${baseUrl}/api/wallet/transactions?${query}`, {
        headers: authHeaders(tokenFor(normalUserId)),
      });
      assert.equal(invalidResponse.status, 400, query);
    }
  });
});

test('normal users cannot invoke credit or debit mutation endpoints', async (t) => {
  const app = createTestApp();
  const creditWallet = t.mock.method(walletService, 'creditWallet', async () => {
    throw new Error('Normal users must not reach wallet mutations.');
  });
  const debitWallet = t.mock.method(walletService, 'debitWallet', async () => {
    throw new Error('Normal users must not reach wallet mutations.');
  });
  t.mock.method(User, 'findById', async (id) => authenticatedUserFor(id));

  await withServer(app, async (baseUrl) => {
    for (const operation of ['credit', 'debit']) {
      const response = await fetch(`${baseUrl}/api/wallet/${operation}`, {
        method: 'POST',
        headers: {
          ...authHeaders(tokenFor(normalUserId)),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          targetUserId: otherUserId.toString(),
          currency: 'VES',
          amount: 100,
          type: operation === 'credit' ? 'BONUS' : 'ADMIN_DEBIT',
          source: 'TEST',
          description: 'Protected operation test',
        }),
      });
      const body = await response.json();

      assert.equal(response.status, 403);
      assert.equal(body.success, false);
    }
    assert.equal(creditWallet.mock.callCount(), 0);
    assert.equal(debitWallet.mock.callCount(), 0);
  });
});

test('admin can perform validated credit and debit against an explicit target wallet', async (t) => {
  const app = createTestApp();
  const mutationResults = {
    wallet: testWallet,
    transaction: { transactionId: 'tx-internal-1', amount: 500 },
  };
  const creditWallet = t.mock.method(walletService, 'creditWallet', async (options) => {
    const { ipAddress, ...details } = options;
    assert.match(ipAddress, /127\.0\.0\.1/);
    assert.deepEqual(details, {
      userId: otherUserId.toString(),
      actorId: adminUserId.toString(),
      currency: 'VES',
      amount: 500,
      type: 'BONUS',
      source: 'ADMIN',
      description: 'Admin test credit',
    });
    return mutationResults;
  });
  const debitWallet = t.mock.method(walletService, 'debitWallet', async (options) => {
    const { ipAddress, ...details } = options;
    assert.match(ipAddress, /127\.0\.0\.1/);
    assert.deepEqual(details, {
      userId: otherUserId.toString(),
      actorId: adminUserId.toString(),
      currency: 'VES',
      amount: 100,
      type: 'ADMIN_DEBIT',
      source: 'ADMIN',
      description: 'Admin test debit',
    });
    return mutationResults;
  });
  t.mock.method(User, 'findById', async (id) => authenticatedUserFor(id));

  await withServer(app, async (baseUrl) => {
    const token = tokenFor(adminUserId);
    for (const [operation, amount, type] of [
      ['credit', 500, 'BONUS'],
      ['debit', 100, 'ADMIN_DEBIT'],
    ]) {
      const response = await fetch(`${baseUrl}/api/wallet/${operation}`, {
        method: 'POST',
        headers: {
          ...authHeaders(token),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          targetUserId: otherUserId.toString(),
          currency: 'VES',
          amount,
          type,
          source: 'ADMIN',
          description: `Admin test ${operation}`,
        }),
      });
      const body = await response.json();

      assert.equal(response.status, 201);
      assert.equal(body.success, true);
      assert.equal(body.wallet.ves, 25000);
      assert.equal(body.transaction.transactionId, 'tx-internal-1');
    }

    assert.equal(creditWallet.mock.callCount(), 1);
    assert.equal(debitWallet.mock.callCount(), 1);
  });
});

test('admin mutation rejects client-supplied balances, caller identity, invalid amounts and types', async (t) => {
  const app = createTestApp();
  const creditWallet = t.mock.method(walletService, 'creditWallet', async () => {
    throw new Error('Invalid request must not reach wallet service.');
  });
  t.mock.method(User, 'findById', async (id) => authenticatedUserFor(id));

  await withServer(app, async (baseUrl) => {
    const invalidBodies = [
      {
        targetUserId: otherUserId.toString(),
        userId: otherUserId.toString(),
        currency: 'VES',
        amount: 100,
        type: 'BONUS',
        source: 'ADMIN',
        description: 'Invalid caller identity field',
      },
      {
        targetUserId: otherUserId.toString(),
        currency: 'VES',
        amount: 100,
        balanceBefore: 0,
        balanceAfter: 100,
        type: 'BONUS',
        source: 'ADMIN',
        description: 'Client cannot send balances',
      },
      {
        targetUserId: otherUserId.toString(),
        currency: 'VES',
        amount: 1.5,
        type: 'BONUS',
        source: 'ADMIN',
        description: 'Fractional amount',
      },
      {
        targetUserId: otherUserId.toString(),
        currency: 'VES',
        amount: 100,
        type: 'WITHDRAWAL',
        source: 'ADMIN',
        description: 'Wrong credit type',
      },
    ];

    for (const body of invalidBodies) {
      const response = await fetch(`${baseUrl}/api/wallet/credit`, {
        method: 'POST',
        headers: {
          ...authHeaders(tokenFor(adminUserId)),
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).success, false);
    }
    assert.equal(creditWallet.mock.callCount(), 0);
  });
});

test('unexpected service errors return a safe JSON error response', async (t) => {
  const app = createTestApp();
  t.mock.method(walletService, 'getWallet', async () => {
    throw new Error('Sensitive database detail');
  });
  t.mock.method(User, 'findById', async (id) => authenticatedUserFor(id));
  t.mock.method(console, 'error', () => {});

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/wallet`, {
      headers: authHeaders(tokenFor(normalUserId)),
    });
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(body, { success: false, message: 'An unexpected error occurred.' });
    assert.doesNotMatch(JSON.stringify(body), /Sensitive database detail/);
  });
});
