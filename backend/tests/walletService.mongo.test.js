const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const test = require('node:test');
const AuditLog = require('../src/models/AuditLog');
const Wallet = require('../src/models/Wallet');
const WalletTransaction = require('../src/models/WalletTransaction');
const walletService = require('../src/services/walletService');

const mongoUri = process.env.WALLET_TEST_MONGO_URI;

test(
  'MongoDB transaction integration: ledger atomicity and concurrent debits',
  { skip: !mongoUri && 'Set WALLET_TEST_MONGO_URI to an isolated replica-set test database.' },
  async (t) => {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
    const userId = new mongoose.Types.ObjectId();

    t.after(async () => {
      await AuditLog.collection.deleteMany({ targetUserId: userId });
      await Wallet.collection.deleteMany({ userId });
      await WalletTransaction.collection.deleteMany({ userId });
      await mongoose.disconnect();
    });

    await Wallet.create({ userId, ves: 1000 });

    const creditResult = await walletService.creditWallet({
      userId,
      currency: 'VES',
      amount: 500,
      type: 'BONUS',
      source: 'INTEGRATION_TEST',
      description: 'Replica-set transaction test credit',
    });
    assert.equal(creditResult.wallet.ves, 1500);
    assert.equal(creditResult.transaction.balanceBefore, 1000);
    assert.equal(creditResult.transaction.balanceAfter, 1500);

    const concurrentDebits = await Promise.allSettled([
      walletService.debitWallet({
        userId,
        currency: 'VES',
        amount: 1000,
        type: 'WITHDRAWAL',
        source: 'INTEGRATION_TEST',
        description: 'Concurrent test withdrawal A',
      }),
      walletService.debitWallet({
        userId,
        currency: 'VES',
        amount: 1000,
        type: 'WITHDRAWAL',
        source: 'INTEGRATION_TEST',
        description: 'Concurrent test withdrawal B',
      }),
    ]);

    assert.equal(concurrentDebits.filter((result) => result.status === 'fulfilled').length, 1);
    const rejectedDebit = concurrentDebits.find((result) => result.status === 'rejected');
    assert.equal(rejectedDebit.reason.statusCode, 409);

    let wallet = await Wallet.findOne({ userId }).lean();
    assert.equal(wallet.ves, 500);

    const ledger = await WalletTransaction.find({ userId }).sort({ createdAt: 1 }).lean();
    assert.equal(ledger.length, 2);
    assert.deepEqual(
      ledger.map(({ balanceBefore, balanceAfter }) => [balanceBefore, balanceAfter]),
      [
        [1000, 1500],
        [1500, 500],
      ],
    );
    await assert.rejects(
      WalletTransaction.updateOne(
        { transactionId: ledger[0].transactionId },
        { $set: { description: 'Tampered ledger entry' } },
      ).exec(),
      /append-only/,
    );

    t.mock.method(WalletTransaction, 'create', async () => {
      throw new Error('Simulated ledger insert failure.');
    });
    await assert.rejects(
      walletService.creditWallet({
        userId,
        currency: 'VES',
        amount: 25,
        type: 'BONUS',
        source: 'INTEGRATION_TEST',
        description: 'Expected rollback',
      }),
      /Simulated ledger insert failure/,
    );

    wallet = await Wallet.findOne({ userId }).lean();
    assert.equal(wallet.ves, 500);
    assert.equal(await WalletTransaction.countDocuments({ userId }), 2);
  },
);
