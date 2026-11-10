process.env.JWT_SECRET = 'test-only-secret-that-is-at-least-32-characters-long';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { once } = require('node:events');
const mongoose = require('mongoose');
const test = require('node:test');
const app = require('../src/app');
const User = require('../src/models/User');
const Wallet = require('../src/models/Wallet');

const mongoUri = process.env.AUTH_TEST_MONGO_URI;

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

test(
  'MongoDB registration creates one zero-balance wallet and preserves user isolation',
  { skip: !mongoUri && 'Set AUTH_TEST_MONGO_URI to an isolated local replica-set database.' },
  async (t) => {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
    const suffix = randomUUID();
    const firstEmail = `auth-first-${suffix}@veloop.test`;
    const secondEmail = `auth-second-${suffix}@veloop.test`;
    const userIds = [];

    t.after(async () => {
      await Wallet.deleteMany({ userId: { $in: userIds } });
      await User.deleteMany({ _id: { $in: userIds } });
      await mongoose.disconnect();
    });

    await Promise.all([User.init(), Wallet.init()]);

    const firstRegistration = {
      name: 'First Auth Test',
      email: firstEmail,
      password: 'secure-test-password',
    };
    const secondRegistration = {
      name: 'Second Auth Test',
      email: secondEmail,
      password: 'secure-test-password',
    };

    await withServer(app, async (baseUrl) => {
      const register = async (details) =>
        fetch(`${baseUrl}/api/auth/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(details),
        });

      const firstResponse = await register(firstRegistration);
      const firstBody = await firstResponse.json();
      assert.equal(firstResponse.status, 201);
      assert.equal(firstBody.user.email, firstEmail);
      assert.equal(firstBody.user.password, undefined);
      assert.equal(firstBody.user.passwordHash, undefined);
      assert.ok(firstBody.token);
      userIds.push(new mongoose.Types.ObjectId(firstBody.user.id));

      const firstWallet = await Wallet.findOne({ userId: firstBody.user.id }).lean();
      assert.ok(firstWallet);
      assert.deepEqual(
        ['ves', 'sves', 'gems', 'tokens', 'spins'].map((currency) => firstWallet[currency]),
        [0, 0, 0, 0, 0],
      );
      assert.equal(await Wallet.countDocuments({ userId: firstBody.user.id }), 1);

      const duplicateResponse = await register(firstRegistration);
      assert.equal(duplicateResponse.status, 409);

      const secondResponse = await register(secondRegistration);
      const secondBody = await secondResponse.json();
      assert.equal(secondResponse.status, 201);
      userIds.push(new mongoose.Types.ObjectId(secondBody.user.id));
      const secondWallet = await Wallet.findOne({ userId: secondBody.user.id }).lean();
      assert.ok(secondWallet);
      assert.notEqual(firstWallet._id.toString(), secondWallet._id.toString());
      assert.equal(await Wallet.countDocuments({ userId: secondBody.user.id }), 1);

      const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: firstEmail,
          password: firstRegistration.password,
        }),
      });
      const loginBody = await loginResponse.json();
      assert.equal(loginResponse.status, 200);
      assert.ok(loginBody.token);

      const incorrectPasswordResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: firstEmail, password: 'wrong-password' }),
      });
      assert.equal(incorrectPasswordResponse.status, 401);

      const ownWalletResponse = await fetch(`${baseUrl}/api/wallet`, {
        headers: { authorization: `Bearer ${firstBody.token}` },
      });
      const ownWalletBody = await ownWalletResponse.json();
      assert.equal(ownWalletResponse.status, 200);
      assert.equal(ownWalletBody.wallet.id, firstWallet._id.toString());

      const suppliedForeignIdResponse = await fetch(
        `${baseUrl}/api/wallet?userId=${secondBody.user.id}`,
        { headers: { authorization: `Bearer ${firstBody.token}` } },
      );
      assert.equal(suppliedForeignIdResponse.status, 400);

      const unauthorizedResponse = await fetch(`${baseUrl}/api/wallet`);
      assert.equal(unauthorizedResponse.status, 401);
    });
  },
);
