process.env.JWT_SECRET = 'test-only-secret-that-is-at-least-32-characters-long';

const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const mongoose = require('mongoose');
const test = require('node:test');
const User = require('../src/models/User');
const PayoutMethod = require('../src/models/PayoutMethod');
const PayoutOption = require('../src/models/PayoutOption');
const payoutConfigService = require('../src/services/payoutConfigService');
const { createToken } = require('../src/controllers/auth.controller');
const { errorHandler, notFoundHandler } = require('../src/middleware/errorHandler');
const payoutRoutes = require('../src/routes/payout.routes');

const userId = new mongoose.Types.ObjectId();
const methodId = 'upi';

function createTestApp() {
  const app = express();
  app.use('/api/payout', payoutRoutes);
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

function authHeaders() {
  return {
    authorization: `Bearer ${createToken(userId.toString())}`,
  };
}

test('payout methods and options endpoints require authentication', async () => {
  await withServer(createTestApp(), async (baseUrl) => {
    for (const path of ['/api/payout/methods', '/api/payout/options/']) {
      const response = await fetch(`${baseUrl}${path}`);
      const body = await response.json();

      assert.equal(response.status, 401);
      assert.deepEqual(body, { success: false, message: 'Authentication required.' });
    }
  });
});

test('GET methods returns methods and options from the configuration service', async (t) => {
  const methods = [
    {
      methodId: 'upi',
      name: 'UPI',
      type: 'UPI',
      active: false,
      availability: 'UNAVAILABLE',
      eligibility: { configurationConfirmed: false },
      options: [{ optionId: 'upi_inr_10_reference', payoutAmount: 10, requiredAmount: 2400 }],
    },
  ];
  const getMethods = t.mock.method(payoutConfigService, 'getMethods', async () => methods);
  t.mock.method(User, 'findById', async (id) => ({
    _id: new mongoose.Types.ObjectId(id),
    role: 'USER',
    accountStatus: 'ACTIVE',
  }));

  await withServer(createTestApp(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/payout/methods`, {
      headers: authHeaders(),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { success: true, methods });
    assert.equal(getMethods.mock.callCount(), 1);
  });
});

test('GET options filters by validated method and rejects invalid query fields', async (t) => {
  const options = [{ optionId: 'upi_inr_10_reference', methodId, active: false }];
  const getOptions = t.mock.method(payoutConfigService, 'getOptions', async (filter) => {
    assert.deepEqual(filter, { methodId });
    return options;
  });
  t.mock.method(User, 'findById', async (id) => ({
    _id: new mongoose.Types.ObjectId(id),
    role: 'USER',
    accountStatus: 'ACTIVE',
  }));

  await withServer(createTestApp(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/payout/options/?method=UPI`, {
      headers: authHeaders(),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { success: true, options });

    for (const query of ['method=not-valid!', 'method=upi&method=paypal', 'other=value']) {
      const invalidResponse = await fetch(`${baseUrl}/api/payout/options/?${query}`, {
        headers: authHeaders(),
      });
      assert.equal(invalidResponse.status, 400, query);
    }
    assert.equal(getOptions.mock.callCount(), 1);
  });
});

test('GET options returns a safe 404 for a valid but unknown method', async (t) => {
  t.mock.method(payoutConfigService, 'getOptions', async () => {
    const error = new Error('Payout method not found.');
    error.statusCode = 404;
    throw error;
  });
  t.mock.method(User, 'findById', async (id) => ({
    _id: new mongoose.Types.ObjectId(id),
    role: 'USER',
    accountStatus: 'ACTIVE',
  }));

  await withServer(createTestApp(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/payout/options/?method=paypal`, {
      headers: authHeaders(),
    });
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.deepEqual(body, { success: false, message: 'Payout method not found.' });
  });
});

test('payout database/service errors do not expose internal details', async (t) => {
  t.mock.method(payoutConfigService, 'getMethods', async () => {
    throw new Error('Sensitive MongoDB connection detail');
  });
  t.mock.method(User, 'findById', async (id) => ({
    _id: new mongoose.Types.ObjectId(id),
    role: 'USER',
    accountStatus: 'ACTIVE',
  }));
  t.mock.method(console, 'error', () => {});

  await withServer(createTestApp(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/payout/methods`, {
      headers: authHeaders(),
    });
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(body, { success: false, message: 'An unexpected error occurred.' });
  });
});

test('payout service groups options from MongoDB method configuration', async (t) => {
  const methods = [
    { methodId: 'amazon', name: 'Amazon Gift Card' },
    { methodId: 'upi', name: 'UPI' },
  ];
  const options = [
    { methodId: 'upi', optionId: 'upi_10', payoutAmount: 10 },
    { methodId: 'upi', optionId: 'upi_25', payoutAmount: 25 },
  ];

  t.mock.method(PayoutMethod, 'find', (filter) => {
    assert.deepEqual(filter, {});
    return {
      sort(sort) {
        assert.deepEqual(sort, { methodId: 1 });
        return { lean: async () => methods };
      },
    };
  });
  t.mock.method(PayoutOption, 'find', (filter) => {
    assert.deepEqual(filter, { methodId: { $in: ['amazon', 'upi'] } });
    return {
      sort(sort) {
        assert.deepEqual(sort, { methodId: 1, requiredAmount: 1, optionId: 1 });
        return { lean: async () => options };
      },
    };
  });

  const result = await payoutConfigService.getMethods();
  assert.deepEqual(result, [
    { ...methods[0], options: [] },
    { ...methods[1], options },
  ]);
});

test('payout selection validates active method and option pairing', async (t) => {
  const activeMethod = {
    methodId,
    active: true,
    availability: 'AVAILABLE',
  };
  const activeOption = {
    optionId: 'upi_10',
    methodId,
    active: true,
    availability: 'AVAILABLE',
  };
  t.mock.method(PayoutMethod, 'findOne', (filter) => ({
    lean: async () => (filter.methodId === methodId ? activeMethod : null),
  }));
  t.mock.method(PayoutOption, 'findOne', (filter) => ({
    lean: async () =>
      filter.optionId === activeOption.optionId && filter.methodId === methodId
        ? activeOption
        : null,
  }));

  const selection = await payoutConfigService.validatePayoutSelection({
    methodId,
    optionId: 'UPI_10',
  });
  assert.deepEqual(selection, { method: activeMethod, option: activeOption });

  await assert.rejects(
    payoutConfigService.validatePayoutSelection({ methodId: 'paypal', optionId: 'upi_10' }),
    { statusCode: 409, message: 'This payout method is currently unavailable.' },
  );
  await assert.rejects(
    payoutConfigService.validatePayoutSelection({ methodId, optionId: 'missing_option' }),
    { statusCode: 409, message: 'Selected payout option is unavailable.' },
  );
});
