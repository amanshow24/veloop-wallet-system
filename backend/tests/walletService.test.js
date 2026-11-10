const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const test = require('node:test');
const AuditLog = require('../src/models/AuditLog');
const Wallet = require('../src/models/Wallet');
const WalletTransaction = require('../src/models/WalletTransaction');
const walletService = require('../src/services/walletService');

const userId = new mongoose.Types.ObjectId();

function installSessionMock(t, { rollback, auditError } = {}) {
  let active = false;
  const session = {
    inTransaction: () => active,
    auditEntries: [],
    withTransaction: async (callback) => {
      active = true;
      try {
        return await callback();
      } catch (error) {
        if (rollback) {
          rollback();
        }
        throw error;
      } finally {
        active = false;
      }
    },
    endSession: async () => {},
  };
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(AuditLog, 'create', async (documents, options) => {
    assert.equal(options.session, session);
    assert.equal(session.inTransaction(), true);
    if (auditError) {
      throw auditError;
    }
    session.auditEntries.push(...documents);
    return documents;
  });
  return session;
}

function findOneQuery(wallet, sessionRef) {
  return {
    session(session) {
      sessionRef.value = session;
      return this;
    },
    async lean() {
      return wallet;
    },
  };
}

test('creditWallet atomically increments the server-side balance and appends a ledger entry', async (t) => {
  const session = installSessionMock(t);
  let atomicUpdate;
  let ledgerEntry;
  let ledgerSession;
  const updatedWallet = { userId, ves: 1500 };

  t.mock.method(Wallet, 'findOneAndUpdate', async (filter, update, options) => {
    assert.equal(options.session, session);
    atomicUpdate = { filter, update };
    return updatedWallet;
  });
  t.mock.method(WalletTransaction, 'create', async (documents, options) => {
    assert.equal(options.session, session);
    assert.equal(session.inTransaction(), true);
    ledgerSession = options.session;
    ledgerEntry = { ...documents[0], transactionId: 'ledger-credit-1' };
    return [ledgerEntry];
  });

  const result = await walletService.creditWallet({
    userId,
    currency: 'ves',
    amount: 500,
    type: 'AD_REWARD',
    source: 'WATCH_AD',
    description: 'Ad reward',
  });

  assert.deepEqual(atomicUpdate.filter, {
    userId,
    ves: { $lte: Number.MAX_SAFE_INTEGER - 500 },
  });
  assert.deepEqual(atomicUpdate.update, { $inc: { ves: 500 } });
  assert.equal(ledgerSession, session);
  assert.equal(ledgerEntry.balanceBefore, 1000);
  assert.equal(ledgerEntry.balanceAfter, 1500);
  assert.equal(ledgerEntry.userId.toString(), userId.toString());
  assert.deepEqual(
    session.auditEntries.map(({ actorType, actorId, action, targetUserId, targetType, metadata }) => ({
      actorType,
      actorId,
      action,
      targetUserId,
      targetType,
      metadata,
    })),
    [
      {
        actorType: 'SYSTEM',
        actorId: null,
        action: 'WALLET_CREDIT',
        targetUserId: userId,
        targetType: 'WALLET',
        metadata: {
          transactionId: 'ledger-credit-1',
          currency: 'VES',
          amount: 500,
          type: 'AD_REWARD',
          source: 'WATCH_AD',
        },
      },
    ],
  );
  assert.equal(result.wallet, updatedWallet);
  assert.equal(result.transaction.transactionId, 'ledger-credit-1');
});

test('debitWallet checks balance and uses a conditional atomic debit', async (t) => {
  const session = installSessionMock(t);
  const sessionRef = { value: null };
  let atomicFilter;
  let ledger;

  t.mock.method(Wallet, 'findOne', (filter) => {
    assert.deepEqual(filter, { userId });
    return findOneQuery({ userId, ves: 1500 }, sessionRef);
  });
  t.mock.method(Wallet, 'findOneAndUpdate', async (filter, update, options) => {
    assert.equal(options.session, session);
    atomicFilter = filter;
    assert.deepEqual(update, { $inc: { ves: -1000 } });
    return { userId, ves: 500 };
  });
  t.mock.method(WalletTransaction, 'create', async (documents, options) => {
    assert.equal(options.session, session);
    ledger = documents[0];
    return [ledger];
  });

  const result = await walletService.debitWallet({
    userId,
    currency: 'VES',
    amount: 1000,
    type: 'WITHDRAWAL',
    source: 'WITHDRAWAL',
    description: 'Demo withdrawal',
    referenceId: 'withdrawal-1',
  });

  assert.equal(sessionRef.value, session);
  assert.deepEqual(atomicFilter, { userId, ves: { $gte: 1000 } });
  assert.equal(ledger.balanceBefore, 1500);
  assert.equal(ledger.balanceAfter, 500);
  assert.equal(ledger.referenceId, 'withdrawal-1');
  assert.equal(result.wallet.ves, 500);
});

test('debitWallet rejects insufficient balance without issuing a wallet update', async (t) => {
  installSessionMock(t);
  const sessionRef = { value: null };
  t.mock.method(Wallet, 'findOne', () =>
    findOneQuery({ userId, ves: 500 }, sessionRef),
  );
  const update = t.mock.method(Wallet, 'findOneAndUpdate', async () => {
    throw new Error('Insufficient debit must not reach wallet update.');
  });

  await assert.rejects(
    walletService.debitWallet({
      userId,
      currency: 'VES',
      amount: 1000,
      type: 'WITHDRAWAL',
      source: 'WITHDRAWAL',
      description: 'Demo withdrawal',
    }),
    { statusCode: 409, message: 'Insufficient VES balance.' },
  );
  assert.equal(update.mock.callCount(), 0);
});

test('a ledger write failure aborts the transaction so the balance cannot commit alone', async (t) => {
  let balance = 1000;
  const session = installSessionMock(t, { rollback: () => { balance = 1000; } });

  t.mock.method(Wallet, 'findOneAndUpdate', async (_filter, update, options) => {
    assert.equal(options.session, session);
    balance += update.$inc.ves;
    return { userId, ves: balance };
  });
  t.mock.method(WalletTransaction, 'create', async () => {
    throw new Error('Simulated ledger storage failure.');
  });

  await assert.rejects(
    walletService.creditWallet({
      userId,
      currency: 'VES',
      amount: 500,
      type: 'BONUS',
      source: 'DEMO',
      description: 'Demo bonus',
    }),
    /Simulated ledger storage failure/,
  );
  assert.equal(balance, 1000);
});

test('an audit write failure aborts the transaction so neither the balance nor ledger can commit alone', async (t) => {
  let balance = 1000;
  const session = installSessionMock(t, {
    rollback: () => { balance = 1000; },
    auditError: new Error('Simulated audit storage failure.'),
  });

  t.mock.method(Wallet, 'findOneAndUpdate', async (_filter, update, options) => {
    assert.equal(options.session, session);
    balance += update.$inc.ves;
    return { userId, ves: balance };
  });
  t.mock.method(WalletTransaction, 'create', async (documents, options) => {
    assert.equal(options.session, session);
    return [{ ...documents[0], transactionId: 'ledger-audit-1' }];
  });
  await assert.rejects(
    walletService.creditWallet({
      userId,
      currency: 'VES',
      amount: 500,
      type: 'BONUS',
      source: 'DEMO',
      description: 'Demo bonus',
    }),
    /Simulated audit storage failure/,
  );
  assert.equal(balance, 1000);
});

test('balance validation rejects invalid currency and fractional or unsafe amounts', async () => {
  await assert.rejects(
    walletService.validateBalance({ userId, currency: 'USD', amount: 1 }),
    { statusCode: 400 },
  );
  await assert.rejects(
    walletService.validateBalance({ userId, currency: 'VES', amount: 0.5 }),
    { statusCode: 400 },
  );
  await assert.rejects(
    walletService.validateBalance({
      userId: 'not-an-object-id',
      currency: 'VES',
      amount: 1,
    }),
    { statusCode: 400 },
  );
});

test('getTransactions scopes by the supplied trusted user ID and validates pagination', async (t) => {
  let capturedFilter;
  const transactions = [{ transactionId: 'tx-1' }];
  const query = {
    sort(sort) {
      assert.deepEqual(sort, { createdAt: -1, _id: -1 });
      return this;
    },
    skip(skip) {
      assert.equal(skip, 20);
      return this;
    },
    limit(limit) {
      assert.equal(limit, 10);
      return this;
    },
    async lean() {
      return transactions;
    },
  };

  t.mock.method(WalletTransaction, 'find', (filter) => {
    capturedFilter = filter;
    return query;
  });
  t.mock.method(WalletTransaction, 'countDocuments', async () => 21);

  const result = await walletService.getTransactions({
    userId,
    page: '3',
    limit: '10',
    currency: 'ves',
    status: 'completed',
  });

  assert.deepEqual(capturedFilter, {
    userId,
    currency: 'VES',
    status: 'COMPLETED',
  });
  assert.equal(result.transactions, transactions);
  assert.deepEqual(result.pagination, { page: 3, limit: 10, total: 21, pages: 3 });
  await assert.rejects(
    walletService.getTransactions({ userId, limit: 101 }),
    { statusCode: 400 },
  );
});

test('ledger entries require an active transaction and consistent snapshots', async (t) => {
  const outsideSession = {
    inTransaction: () => false,
  };
  await assert.rejects(
    walletService.createLedgerEntry({
      userId,
      currency: 'VES',
      type: 'BONUS',
      amount: 10,
      balanceBefore: 0,
      balanceAfter: 10,
      source: 'DEMO',
      description: 'Demo credit',
      session: outsideSession,
    }),
    /inside a MongoDB transaction/,
  );

  const session = installSessionMock(t);
  await session.withTransaction(async () => {
    await assert.rejects(
      walletService.createLedgerEntry({
        userId,
        currency: 'VES',
        type: 'BONUS',
        amount: 10,
        balanceBefore: 0,
        balanceAfter: 11,
        source: 'DEMO',
        description: 'Demo credit',
        session,
      }),
      { statusCode: 400 },
    );
  });
});
