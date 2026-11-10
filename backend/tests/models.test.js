const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const test = require('node:test');
const AuditLog = require('../src/models/AuditLog');
const PayoutMethod = require('../src/models/PayoutMethod');
const PayoutOption = require('../src/models/PayoutOption');
const User = require('../src/models/User');
const Wallet = require('../src/models/Wallet');
const WalletTransaction = require('../src/models/WalletTransaction');
const Withdrawal = require('../src/models/Withdrawal');
const { DEMO_BALANCES, DEMO_TRANSACTIONS } = require('../seed/demo');
const {
  PAYOUT_METHODS,
  UPI_REFERENCE_VALUES,
  assertDevelopmentDatabase,
  upsertPayoutConfiguration,
} = require('../seed/payoutReference');

const userId = new mongoose.Types.ObjectId();

test('User model retains auth fields, safe defaults, and unique email index', () => {
  const user = new User({
    name: ' Demo User ',
    email: 'DEMO@EXAMPLE.COM',
    passwordHash: 'bcrypt-hash',
  });

  assert.equal(user.name, 'Demo User');
  assert.equal(user.email, 'demo@example.com');
  assert.equal(user.accountStatus, 'ACTIVE');
  assert.equal(user.role, 'USER');
  assert.ok(User.schema.indexes().some(([keys, options]) => keys.email === 1 && options.unique));
});

test('Wallet supports the five nonnegative integer balances and one wallet per user', () => {
  const wallet = new Wallet({ userId, ...DEMO_BALANCES });

  assert.equal(wallet.validateSync(), undefined);
  assert.deepEqual(
    ['ves', 'sves', 'gems', 'tokens', 'spins'].map((currency) => wallet[currency]),
    [25000, 5000, 100, 500, 3],
  );
  assert.ok(Wallet.schema.indexes().some(([keys, options]) => keys.userId === 1 && options.unique));

  wallet.ves = 25000.5;
  assert.match(wallet.validateSync().errors.ves.message, /safe integer/);
  wallet.ves = -1;
  assert.match(wallet.validateSync().errors.ves.message, /less than minimum allowed/);
});

test('WalletTransaction validates ledger currencies, types, integer balances, and indexes', () => {
  const transaction = new WalletTransaction({
    userId,
    currency: 'VES',
    type: 'AD_REWARD',
    amount: 500,
    balanceBefore: 1000,
    balanceAfter: 1500,
    source: 'WATCH_AD',
    description: 'Demo ad reward',
  });

  assert.equal(transaction.validateSync(), undefined);
  assert.ok(transaction.transactionId);
  assert.equal(transaction.status, 'COMPLETED');
  assert.ok(
    WalletTransaction.schema
      .indexes()
      .some(([keys, options]) => keys.transactionId === 1 && options.unique),
  );
  assert.ok(WalletTransaction.schema.indexes().some(([keys]) => keys.userId === 1 && keys.createdAt === -1));

  transaction.amount = 1.25;
  assert.match(transaction.validateSync().errors.amount.message, /safe integer/);
  transaction.amount = 1;
  transaction.currency = 'USD';
  assert.match(transaction.validateSync().errors.currency.message, /is not a valid enum value/);
});

test('Withdrawal includes assignment fields, status timestamps, and safe integer amounts', () => {
  const requestedAt = new Date();
  const withdrawal = new Withdrawal({
    userId,
    idempotencyKey: 'withdrawal-test-key',
    requestFingerprint: 'a'.repeat(64),
    method: 'upi',
    optionId: 'upi_10',
    currency: 'VES',
    currencyAmount: 2400,
    payoutAmount: 10,
    payoutCurrency: 'INR',
    payoutDetails: { upiId: 'demo@upi.invalid' },
    requestedAt,
  });

  assert.equal(withdrawal.validateSync(), undefined);
  assert.equal(withdrawal.method, 'upi');
  assert.equal(withdrawal.status, 'PENDING');
  assert.equal(withdrawal.idempotencyKey, 'withdrawal-test-key');
  assert.equal(withdrawal.requestedAt.getTime(), requestedAt.getTime());
  assert.equal(withdrawal.processedAt, null);
  assert.ok(withdrawal.withdrawalId);

  const missingPayoutDetails = new Withdrawal({
    userId,
    idempotencyKey: 'withdrawal-test-key-2',
    requestFingerprint: 'b'.repeat(64),
    method: 'upi',
    optionId: 'upi_10',
    currency: 'VES',
    currencyAmount: 2400,
    payoutAmount: 10,
    payoutCurrency: 'INR',
  });
  assert.match(missingPayoutDetails.validateSync().errors.payoutDetails.message, /required/);

  withdrawal.currencyAmount = 2400.5;
  assert.match(withdrawal.validateSync().errors.currencyAmount.message, /safe integer/);
  assert.ok(
    Withdrawal.schema.indexes().some(
      ([keys, options]) => keys.userId === 1 && keys.idempotencyKey === 1 && options.unique,
    ),
  );
});

test('PayoutOption validates backend configuration and indexes availability', () => {
  const option = new PayoutOption({
    optionId: 'upi_10',
    methodId: 'upi',
    name: 'UPI demo option',
    type: 'UPI',
    currency: 'VES',
    requiredAmount: 2400,
    payoutAmount: 10,
    payoutCurrency: 'INR',
    requiredDetails: ['upiId'],
    eligibility: { accountStatus: 'ACTIVE' },
    metadata: { isDemo: true },
  });

  assert.equal(option.validateSync(), undefined);
  assert.equal(option.active, true);
  assert.equal(option.availability, 'AVAILABLE');
  assert.ok(
    PayoutOption.schema.indexes().some(([keys, options]) => keys.optionId === 1 && options.unique),
  );

  option.requiredAmount = 2400.75;
  assert.match(option.validateSync().errors.requiredAmount.message, /safe integer/);
});

test('PayoutMethod validates supported method catalog and defaults unavailable', () => {
  const method = new PayoutMethod({
    methodId: 'upi',
    name: 'UPI',
    type: 'UPI',
    eligibility: { configurationConfirmed: false },
    metadata: { source: 'ASSIGNMENT_REFERENCE' },
  });

  assert.equal(method.validateSync(), undefined);
  assert.equal(method.active, false);
  assert.equal(method.availability, 'UNAVAILABLE');
  assert.ok(
    PayoutMethod.schema
      .indexes()
      .some(([keys, options]) => keys.methodId === 1 && options.unique),
  );
  assert.match(
    new PayoutMethod({ methodId: 'cash', name: 'Cash', type: 'OTHER' }).validateSync()
      .errors.type.message,
    /is not a valid enum value/,
  );
});

test('AuditLog records actors and sensitive actions with immutable creation timestamps', () => {
  const log = new AuditLog({
    actorId: userId,
    action: 'WALLET_CREDIT',
    targetUserId: userId,
    targetType: 'WALLET',
    referenceId: 'demo-credit',
    metadata: { isDemo: true },
  });

  assert.equal(log.validateSync(), undefined);
  assert.equal(log.actorType, 'USER');
  assert.equal(AuditLog.schema.options.timestamps.updatedAt, false);
  assert.ok(AuditLog.schema.indexes().some(([keys]) => keys.actorId === 1 && keys.createdAt === -1));

  const systemLog = new AuditLog({
    actorType: 'SYSTEM',
    action: 'WALLET_CREDIT',
    targetUserId: userId,
    targetType: 'WALLET',
  });
  assert.equal(systemLog.validateSync(), undefined);
  assert.equal(systemLog.actorId, null);
  assert.match(
    new AuditLog({
      action: 'WALLET_CREDIT',
      targetUserId: userId,
      targetType: 'WALLET',
    }).validateSync().errors.actorId.message,
    /Path `actorId` is required/,
  );
});

test('AuditLog rejects update and delete operations', async () => {
  await assert.rejects(
    AuditLog.updateOne({ _id: userId }, { $set: { action: 'WALLET_DEBIT' } }).exec(),
    /Audit log records are append-only/,
  );
  await assert.rejects(
    AuditLog.deleteMany({ _id: userId }).exec(),
    /Audit log records are append-only/,
  );
});

test('demo ledger fixture reconciles to the seeded VEs balance', () => {
  const finalBalance = DEMO_TRANSACTIONS.reduce((balance, transaction) => {
    assert.equal(transaction.balanceBefore, balance);
    assert.equal(
      transaction.balanceAfter,
      transaction.type === 'WITHDRAWAL'
        ? balance - transaction.amount
        : balance + transaction.amount,
    );
    return transaction.balanceAfter;
  }, 0);

  assert.equal(finalBalance, DEMO_BALANCES.ves);
  assert.ok(DEMO_TRANSACTIONS.every((transaction) => transaction.transactionId.startsWith('demo-')));
});

test('payout reference seed activates UPI and documents eight assignment values', () => {
  assert.deepEqual(
    PAYOUT_METHODS.map(({ methodId }) => methodId),
    ['upi', 'paypal', 'amazon', 'google_play'],
  );
  assert.deepEqual(
    PAYOUT_METHODS.map(({ active, availability }) => [active, availability]),
    [
      [true, 'AVAILABLE'],
      [false, 'UNAVAILABLE'],
      [false, 'UNAVAILABLE'],
      [false, 'UNAVAILABLE'],
    ],
  );
  assert.deepEqual(
    UPI_REFERENCE_VALUES.map(({ payoutAmount, requiredAmount }) => [payoutAmount, requiredAmount]),
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
    UPI_REFERENCE_VALUES.every(
      (option) =>
        option.active &&
        option.availability === 'AVAILABLE' &&
        option.eligibility.configurationConfirmed &&
        option.metadata.referenceOnly,
    ),
  );
});

test('payout reference seed only accepts development and test database names', () => {
  assert.doesNotThrow(() =>
    assertDevelopmentDatabase('mongodb://localhost:27017/veloop_wallet_dev'),
  );
  assert.doesNotThrow(() =>
    assertDevelopmentDatabase('mongodb://localhost:27017/veloop_payout_test'),
  );
  assert.doesNotThrow(() =>
    assertDevelopmentDatabase(
      'mongodb://localhost:27017/veloop_wallet_dev',
      'veloop_wallet_dev',
    ),
  );
  assert.throws(
    () => assertDevelopmentDatabase('mongodb://localhost:27017/veloop_wallet'),
    /development or test database/,
  );
  assert.throws(
    () =>
      assertDevelopmentDatabase(
        'mongodb://localhost:27017/another_wallet_dev',
        'veloop_wallet_dev',
      ),
    /explicitly selected payout database/,
  );
});

test('payout configuration changes are audited transactionally and unchanged seeds do not repeat audits', async (t) => {
  const session = {};
  const configuration = {
    active: true,
    availability: 'AVAILABLE',
    metadata: { source: 'ASSIGNMENT_REFERENCE' },
    requiredDetails: ['upiId'],
  };
  let current;
  const model = {
    findOne(filter) {
      assert.deepEqual(filter, { methodId: 'upi' });
      return {
        session(transactionSession) {
          assert.equal(transactionSession, session);
          return this;
        },
        async lean() {
          return current;
        },
      };
    },
    async findOneAndUpdate(filter, update, options) {
      assert.deepEqual(filter, { methodId: 'upi' });
      assert.deepEqual(update.$set, {
        ...configuration,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      assert.equal(options.session, session);
      current = { ...configuration };
    },
  };
  const auditEntries = [];
  t.mock.method(AuditLog, 'create', async (documents, options) => {
    assert.equal(options.session, session);
    auditEntries.push(...documents);
    return documents;
  });

  const firstResult = await upsertPayoutConfiguration({
    model,
    identityField: 'methodId',
    identity: 'upi',
    targetType: 'PAYOUT_METHOD',
    configuration,
    now: new Date('2026-01-01T00:00:00.000Z'),
    session,
  });
  assert.equal(firstResult, true);
  assert.equal(auditEntries.length, 1);
  assert.equal(auditEntries[0].actorType, 'SYSTEM');
  assert.equal(auditEntries[0].action, 'PAYOUT_CONFIGURATION_CHANGED');
  assert.equal(auditEntries[0].targetType, 'PAYOUT_METHOD');
  assert.equal(auditEntries[0].referenceId, 'upi');
  assert.deepEqual(auditEntries[0].metadata, {
    resourceType: 'PAYOUT_METHOD',
    methodId: 'upi',
    active: true,
    availability: 'AVAILABLE',
    source: 'ASSIGNMENT_REFERENCE',
  });

  const repeatedResult = await upsertPayoutConfiguration({
    model,
    identityField: 'methodId',
    identity: 'upi',
    targetType: 'PAYOUT_METHOD',
    configuration,
    now: new Date('2026-01-01T00:00:00.000Z'),
    session,
  });
  assert.equal(repeatedResult, false);
  assert.equal(auditEntries.length, 1);
});
