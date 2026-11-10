const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const mongoose = require('mongoose');
const test = require('node:test');
const AuditLog = require('../src/models/AuditLog');
const PayoutMethod = require('../src/models/PayoutMethod');
const PayoutOption = require('../src/models/PayoutOption');
const User = require('../src/models/User');
const Wallet = require('../src/models/Wallet');
const WalletTransaction = require('../src/models/WalletTransaction');
const Withdrawal = require('../src/models/Withdrawal');
const withdrawalService = require('../src/services/withdrawalService');

const mongoUri = process.env.WITHDRAWAL_TEST_MONGO_URI;

test(
  'MongoDB withdrawal transactions enforce idempotency, balances, ownership, and exact reversal',
  { skip: !mongoUri && 'Set WITHDRAWAL_TEST_MONGO_URI to an isolated local replica-set database.' },
  async (t) => {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });

    const suffix = randomBytes(6).toString('hex');
    const methodId = `upi_test_${suffix}`;
    const optionId = `option_${suffix}`;
    const userIds = Array.from({ length: 6 }, () => new mongoose.Types.ObjectId());
    const [primaryId, insufficientId, concurrentId, duplicateConcurrentId, rejectedId, adminId] =
      userIds;

    t.after(async () => {
      await Promise.all([
        Withdrawal.deleteMany({ userId: { $in: userIds } }),
        WalletTransaction.collection.deleteMany({ userId: { $in: userIds } }),
        Wallet.deleteMany({ userId: { $in: userIds } }),
        AuditLog.collection.deleteMany({ targetUserId: { $in: userIds } }),
        PayoutOption.deleteMany({ methodId }),
        PayoutMethod.deleteMany({ methodId }),
        User.deleteMany({ _id: { $in: userIds } }),
      ]);
      await mongoose.disconnect();
    });

    await Promise.all([
      Withdrawal.init(),
      WalletTransaction.init(),
      PayoutMethod.init(),
      PayoutOption.init(),
    ]);

    const userDocs = userIds.map((id, index) => ({
      _id: id,
      name: `Withdrawal Test User ${index}`,
      email: `withdrawal-${suffix}-${index}@veloop.test`,
      passwordHash: 'not-used-in-this-test',
      role: index === userIds.length - 1 ? 'ADMIN' : 'USER',
      accountStatus: 'ACTIVE',
    }));
    await User.create(userDocs);
    await Wallet.create([
      { userId: primaryId, ves: 25000 },
      { userId: insufficientId, ves: 1000 },
      { userId: concurrentId, ves: 30000 },
      { userId: duplicateConcurrentId, ves: 25000 },
      { userId: rejectedId, ves: 25000 },
    ]);
    const eligibility = {
      accountStatus: 'ACTIVE',
      configurationConfirmed: true,
      manualReviewRequired: true,
    };
    await PayoutMethod.create({
      methodId,
      name: 'Test UPI',
      type: 'UPI',
      active: true,
      availability: 'AVAILABLE',
      eligibility,
      requiredDetails: ['upiId'],
    });
    await PayoutOption.create({
      optionId,
      methodId,
      name: 'Test redemption',
      type: 'UPI',
      currency: 'VES',
      requiredAmount: 24000,
      payoutAmount: 10,
      payoutCurrency: 'INR',
      active: true,
      availability: 'AVAILABLE',
      eligibility,
    });

    const createFor = (id, idempotencyKey, upiId = 'demo@upi') =>
      withdrawalService.createWithdrawal({
        userId: id,
        actorId: id,
        methodId,
        optionId,
        payoutDetails: { upiId },
        idempotencyKey,
      });

    const created = await createFor(primaryId, `primary-${suffix}`);
    assert.equal(created.replayed, false);
    assert.equal(created.withdrawal.status, 'PENDING');
    assert.equal(created.withdrawal.currencyAmount, 24000);
    assert.equal(created.withdrawal.payoutAmount, 10);
    assert.equal(created.withdrawal.payoutCurrency, 'INR');
    assert.equal((await Wallet.findOne({ userId: primaryId }).lean()).ves, 1000);

    const replay = await createFor(primaryId, `primary-${suffix}`);
    assert.equal(replay.replayed, true);
    assert.equal(replay.withdrawal.withdrawalId, created.withdrawal.withdrawalId);
    await assert.rejects(
      createFor(primaryId, `primary-${suffix}`, 'different@upi'),
      { statusCode: 409 },
    );
    assert.equal(await Withdrawal.countDocuments({ userId: primaryId }), 1);
    assert.equal(await WalletTransaction.countDocuments({ userId: primaryId }), 1);

    await assert.rejects(
      withdrawalService.createWithdrawal({
        userId: primaryId,
        actorId: primaryId,
        methodId,
        optionId: `missing_${suffix}`,
        payoutDetails: { upiId: 'demo@upi' },
        idempotencyKey: `missing-${suffix}`,
      }),
      { statusCode: 409, message: 'Selected payout option is unavailable.' },
    );
    await assert.rejects(createFor(insufficientId, `insufficient-${suffix}`), {
      statusCode: 409,
      message: 'Insufficient VES balance.',
    });
    assert.equal((await Wallet.findOne({ userId: insufficientId }).lean()).ves, 1000);
    assert.equal(await Withdrawal.countDocuments({ userId: insufficientId }), 0);

    const concurrent = await Promise.allSettled([
      createFor(concurrentId, `concurrent-a-${suffix}`),
      createFor(concurrentId, `concurrent-b-${suffix}`),
    ]);
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(concurrent.filter((result) => result.status === 'rejected').length, 1);
    assert.equal((await Wallet.findOne({ userId: concurrentId }).lean()).ves, 6000);
    assert.equal(await Withdrawal.countDocuments({ userId: concurrentId }), 1);

    const sameKeyConcurrent = await Promise.all([
      createFor(duplicateConcurrentId, `same-key-${suffix}`),
      createFor(duplicateConcurrentId, `same-key-${suffix}`),
    ]);
    assert.equal(
      sameKeyConcurrent.filter((result) => result.withdrawal.withdrawalId ===
        sameKeyConcurrent[0].withdrawal.withdrawalId).length,
      2,
    );
    assert.equal(await Withdrawal.countDocuments({ userId: duplicateConcurrentId }), 1);
    assert.equal(await WalletTransaction.countDocuments({ userId: duplicateConcurrentId }), 1);
    assert.equal((await Wallet.findOne({ userId: duplicateConcurrentId }).lean()).ves, 1000);

    const rejected = await createFor(rejectedId, `rejected-${suffix}`);
    const rejectedWithdrawalId = rejected.withdrawal.withdrawalId;
    assert.equal((await Wallet.findOne({ userId: rejectedId }).lean()).ves, 1000);
    const rejectionAttempts = await Promise.allSettled([
      withdrawalService.transitionWithdrawal({
        withdrawalId: rejectedWithdrawalId,
        actorId: adminId,
        action: 'reject',
        reason: 'Payout details could not be verified.',
      }),
      withdrawalService.transitionWithdrawal({
        withdrawalId: rejectedWithdrawalId,
        actorId: adminId,
        action: 'reject',
        reason: 'Duplicate concurrent rejection.',
      }),
    ]);
    assert.equal(rejectionAttempts.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(
      rejectionAttempts.find((result) => result.status === 'fulfilled').value.status,
      'REJECTED',
    );
    assert.equal((await Wallet.findOne({ userId: rejectedId }).lean()).ves, 25000);
    assert.equal(
      await WalletTransaction.countDocuments({
        userId: rejectedId,
        source: 'WITHDRAWAL_REVERSAL',
        referenceId: `${rejectedWithdrawalId}:reversal`,
      }),
      1,
    );
    assert.equal(
      rejectionAttempts.find((result) => result.status === 'rejected').reason.statusCode,
      409,
    );
    assert.equal(
      await WalletTransaction.countDocuments({
        userId: rejectedId,
        source: 'WITHDRAWAL_REVERSAL',
      }),
      1,
    );

    await withdrawalService.transitionWithdrawal({
      withdrawalId: created.withdrawal.withdrawalId,
      actorId: adminId,
      action: 'process',
    });
    const approved = await withdrawalService.transitionWithdrawal({
      withdrawalId: created.withdrawal.withdrawalId,
      actorId: adminId,
      action: 'approve',
      reviewNote: 'Test payout approved.',
    });
    assert.equal(approved.status, 'APPROVED');

    await assert.rejects(
      withdrawalService.getWithdrawal({
        userId: insufficientId,
        withdrawalId: created.withdrawal.withdrawalId,
      }),
      { statusCode: 404 },
    );

    assert.equal(
      await AuditLog.countDocuments({
        targetUserId: rejectedId,
        referenceId: rejectedWithdrawalId,
      }),
      3,
    );
  },
);
