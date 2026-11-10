process.env.JWT_SECRET = 'test-only-secret-that-is-at-least-32-characters-long';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const mongoose = require('mongoose');
const test = require('node:test');

const mongoUri = process.env.PAYOUT_TEST_MONGO_URI;
const optionIds = [
  'upi_inr_10_reference',
  'upi_inr_25_reference',
  'upi_inr_50_reference',
  'upi_inr_100_reference',
  'upi_inr_150_reference',
  'upi_inr_300_reference',
  'upi_inr_500_reference',
  'upi_inr_1000_reference',
];
const methodIds = ['upi', 'paypal', 'amazon', 'google_play'];

if (mongoUri) {
  const databaseName = decodeURIComponent(new URL(mongoUri).pathname.slice(1));
  if (!/(?:^|[_-])test$/i.test(databaseName)) {
    throw new Error('PAYOUT_TEST_MONGO_URI must target a dedicated database ending in test.');
  }
}

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
  'MongoDB payout seed activates UPI and both payout APIs serve its configured options',
  { skip: !mongoUri && 'Set PAYOUT_TEST_MONGO_URI to a disposable database ending in test.' },
  async (t) => {
    process.env.NODE_ENV = 'development';
    process.env.MONGO_URI = mongoUri;
    process.env.SEED_PAYOUT_REFERENCE_VALUES = 'true';

    const app = require('../src/app');
    const PayoutMethod = require('../src/models/PayoutMethod');
    const PayoutOption = require('../src/models/PayoutOption');
    const User = require('../src/models/User');
    const Wallet = require('../src/models/Wallet');
    const { createToken } = require('../src/controllers/auth.controller');
    const { seedPayoutReference } = require('../seed/payoutReference');

    const user = new User({
      name: 'Payout API Test',
      email: `payout-api-${new mongoose.Types.ObjectId()}@veloop.test`,
      passwordHash: 'test-only-password-hash',
    });

    t.after(async () => {
      if (mongoose.connection.readyState !== 1) {
        return;
      }
      await User.deleteOne({ _id: user._id });
      await PayoutOption.deleteMany({ optionId: { $in: optionIds } });
      await PayoutMethod.deleteMany({ methodId: { $in: methodIds } });
      await mongoose.disconnect();
    });

    await seedPayoutReference();
    await Promise.all([PayoutMethod.init(), PayoutOption.init(), User.init()]);
    await seedPayoutReference();
    await user.save();

    const token = createToken(user._id.toString());
    const headers = { authorization: `Bearer ${token}` };

    await withServer(app, async (baseUrl) => {
      const methodsResponse = await fetch(`${baseUrl}/api/payout/methods`, { headers });
      const methodsBody = await methodsResponse.json();
      assert.equal(methodsResponse.status, 200);
      assert.equal(methodsBody.success, true);
      assert.equal(methodsBody.methods.length, 4);

      const upi = methodsBody.methods.find((method) => method.methodId === 'upi');
      assert.equal(upi.active, true);
      assert.equal(upi.availability, 'AVAILABLE');
      assert.equal(upi.options.length, optionIds.length);
      assert.ok(upi.options.every((option) => option.active && option.availability === 'AVAILABLE'));
      assert.deepEqual(
        upi.options.map(({ payoutAmount, requiredAmount }) => [payoutAmount, requiredAmount]),
        [
          [10, 2400],
          [25, 5800],
          [50, 10000],
          [100, 19500],
          [150, 28500],
          [300, 52500],
          [500, 80500],
          [1000, 150000],
        ],
      );
      assert.ok(
        methodsBody.methods
          .filter((method) => method.methodId !== 'upi')
          .every((method) => !method.active && method.availability === 'UNAVAILABLE'),
      );

      const filteredOptionsResponse = await fetch(
        `${baseUrl}/api/payout/options/?method=upi`,
        { headers },
      );
      const filteredOptionsBody = await filteredOptionsResponse.json();
      assert.equal(filteredOptionsResponse.status, 200);
      assert.equal(filteredOptionsBody.success, true);
      assert.equal(filteredOptionsBody.options.length, optionIds.length);
      assert.ok(filteredOptionsBody.options.every((option) => option.methodId === 'upi'));

      const allOptionsResponse = await fetch(`${baseUrl}/api/payout/options/`, { headers });
      const allOptionsBody = await allOptionsResponse.json();
      assert.equal(allOptionsResponse.status, 200);
      assert.equal(allOptionsBody.options.length, optionIds.length);

      const walletCount = await Wallet.countDocuments({ userId: user._id });
      assert.equal(walletCount, 0);
    });
  },
);
