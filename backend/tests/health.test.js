const assert = require('node:assert/strict');
const { once } = require('node:events');
const mongoose = require('mongoose');
const test = require('node:test');
const app = require('../src/app');

test('GET /api/health returns the API status', async () => {
  const server = app.listen(0);
  await once(server, 'listening');

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(
      { success: body.success, service: body.service, status: body.status },
      {
        success: true,
        service: 'veloop-wallet-backend',
        status: 'ok',
      },
    );
    assert.ok(Number.isFinite(Date.parse(body.timestamp)));
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('GET /api/ready reports database readiness without exposing connection details', async () => {
  const server = app.listen(0);
  await once(server, 'listening');

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ready`);
    const body = await response.json();
    const ready = mongoose.connection.readyState === 1;

    assert.equal(response.status, ready ? 200 : 503);
    assert.deepEqual(
      { success: body.success, service: body.service, status: body.status },
      {
        success: ready,
        service: 'veloop-wallet-backend',
        status: ready ? 'ready' : 'unavailable',
      },
    );
    assert.ok(Number.isFinite(Date.parse(body.timestamp)));
    assert.equal('database' in body, false);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('JSON request bodies over the configured size limit return a clear 413 response', async () => {
  const server = app.listen(0);
  await once(server, 'listening');

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(33 * 1024) }),
    });

    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), {
      success: false,
      message: 'Request body is too large.',
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
