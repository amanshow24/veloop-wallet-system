const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const Wallet = require('../models/Wallet');
const WalletTransaction = require('../models/WalletTransaction');
const { TRANSACTION_TYPES, WALLET_CURRENCIES } = require('../models/constants');
const { isPlainObject } = require('../models/schemaFields');
const httpError = require('../utils/httpError');

const CREDIT_TYPES = new Set([
  'CREDIT',
  'REWARD',
  'BONUS',
  'REFERRAL',
  'DAILY_REWARD',
  'AD_REWARD',
  'GAME_REWARD',
  'ADMIN_CREDIT',
  'EXCHANGE_CREDIT',
]);
const DEBIT_TYPES = new Set([
  'DEBIT',
  'WITHDRAWAL',
  'EXCHANGE_DEBIT',
  'ADMIN_DEBIT',
  'CORRECTION',
]);
const MAX_PAGE = 1000000;
const MAX_LIMIT = 100;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

function normalizeUserId(userId) {
  if (!mongoose.isObjectIdOrHexString(userId)) {
    throw httpError(400, 'A valid authenticated user ID is required.');
  }
  return new mongoose.Types.ObjectId(userId);
}

function normalizeCurrency(currency) {
  if (typeof currency !== 'string') {
    throw httpError(400, 'A valid wallet currency is required.');
  }
  const normalized = currency.trim().toUpperCase();
  if (!WALLET_CURRENCIES.includes(normalized)) {
    throw httpError(400, 'Unsupported wallet currency.');
  }
  return normalized;
}

function currencyField(currency) {
  return normalizeCurrency(currency).toLowerCase();
}

function validateAmount(amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw httpError(400, 'Amount must be a positive safe integer.');
  }
  return amount;
}

function normalizeOperationType(type, allowedTypes, operation) {
  if (typeof type !== 'string') {
    throw httpError(400, `A valid ${operation} transaction type is required.`);
  }
  const normalized = type.trim().toUpperCase();
  if (!TRANSACTION_TYPES.includes(normalized) || !allowedTypes.has(normalized)) {
    throw httpError(400, `Transaction type is not valid for a wallet ${operation}.`);
  }
  return normalized;
}

function validateLedgerDetails({ source, description, metadata, referenceId }) {
  if (typeof source !== 'string' || source.trim().length === 0 || source.trim().length > 64) {
    throw httpError(400, 'Transaction source must be between 1 and 64 characters.');
  }
  if (
    typeof description !== 'string' ||
    description.trim().length === 0 ||
    description.trim().length > 300
  ) {
    throw httpError(400, 'Transaction description must be between 1 and 300 characters.');
  }
  if (metadata !== undefined && !isPlainObject(metadata)) {
    throw httpError(400, 'Transaction metadata must be a plain object.');
  }
  if (
    referenceId !== undefined &&
    referenceId !== null &&
    (typeof referenceId !== 'string' || referenceId.trim().length > 128)
  ) {
    throw httpError(400, 'Transaction reference ID must be at most 128 characters.');
  }
}

function requireTransactionSession(session) {
  if (!session || typeof session.inTransaction !== 'function' || !session.inTransaction()) {
    throw new Error('Ledger entries must be created inside a MongoDB transaction.');
  }
}

async function getWallet(userId) {
  const authenticatedUserId = normalizeUserId(userId);
  const wallet = await Wallet.findOne({ userId: authenticatedUserId });
  if (!wallet) {
    throw httpError(404, 'Wallet not found.');
  }
  return wallet;
}

async function validateBalance({ userId, currency, amount, session } = {}) {
  const authenticatedUserId = normalizeUserId(userId);
  const field = currencyField(currency);
  const requiredAmount = validateAmount(amount);
  let query = Wallet.findOne({ userId: authenticatedUserId });
  if (session) {
    query = query.session(session);
  }
  const wallet = await query.lean();

  if (!wallet) {
    throw httpError(404, 'Wallet not found.');
  }

  const availableBalance = wallet[field];
  if (!Number.isSafeInteger(availableBalance) || availableBalance < 0) {
    throw httpError(500, 'Stored wallet balance is invalid.');
  }

  return {
    availableBalance,
    requiredAmount,
    sufficient: availableBalance >= requiredAmount,
  };
}

async function createLedgerEntry({
  userId,
  currency,
  type,
  amount,
  balanceBefore,
  balanceAfter,
  source,
  referenceId = null,
  status = 'COMPLETED',
  description,
  metadata = {},
  session,
} = {}) {
  requireTransactionSession(session);
  const authenticatedUserId = normalizeUserId(userId);
  const normalizedCurrency = normalizeCurrency(currency);
  const normalizedAmount = validateAmount(amount);
  const normalizedType = typeof type === 'string' ? type.trim().toUpperCase() : '';

  if (!TRANSACTION_TYPES.includes(normalizedType)) {
    throw httpError(400, 'Unsupported wallet transaction type.');
  }
  if (
    !Number.isSafeInteger(balanceBefore) ||
    balanceBefore < 0 ||
    !Number.isSafeInteger(balanceAfter) ||
    balanceAfter < 0
  ) {
    throw httpError(400, 'Ledger balances must be nonnegative safe integers.');
  }
  const expectedBalanceAfter = CREDIT_TYPES.has(normalizedType)
    ? balanceBefore + normalizedAmount
    : DEBIT_TYPES.has(normalizedType)
      ? balanceBefore - normalizedAmount
      : Number.NaN;
  if (
    !Number.isSafeInteger(expectedBalanceAfter) ||
    expectedBalanceAfter < 0 ||
    balanceAfter !== expectedBalanceAfter
  ) {
    throw httpError(400, 'Ledger balance snapshots do not match the transaction.');
  }
  if (!['PENDING', 'COMPLETED', 'FAILED', 'REVERSED'].includes(status)) {
    throw httpError(400, 'Unsupported wallet transaction status.');
  }
  validateLedgerDetails({ source, description, metadata, referenceId });

  const [entry] = await WalletTransaction.create(
    [
      {
        userId: authenticatedUserId,
        currency: normalizedCurrency,
        type: normalizedType,
        amount: normalizedAmount,
        balanceBefore,
        balanceAfter,
        source: source.trim(),
        referenceId: referenceId == null ? null : referenceId.trim(),
        status,
        description: description.trim(),
        metadata,
      },
    ],
    { session },
  );
  return entry;
}

async function mutateWallet({
  userId,
  currency,
  amount,
  type,
  source,
  referenceId,
  description,
  metadata,
  actorId,
  ipAddress,
  operation,
  session: suppliedSession,
}) {
  const authenticatedUserId = normalizeUserId(userId);
  const normalizedActorId = actorId == null ? null : normalizeUserId(actorId);
  const normalizedCurrency = normalizeCurrency(currency);
  const field = currencyField(currency);
  const normalizedAmount = validateAmount(amount);
  const allowedTypes = operation === 'credit' ? CREDIT_TYPES : DEBIT_TYPES;
  const normalizedType = normalizeOperationType(type, allowedTypes, operation);
  validateLedgerDetails({ source, description, metadata, referenceId });

  let result;

  const execute = async (session) => {
    if (!session?.inTransaction()) {
      throw new Error('Wallet mutations require an active MongoDB transaction.');
    }

    if (operation === 'debit') {
      const balance = await validateBalance({
        userId: authenticatedUserId,
        currency,
        amount: normalizedAmount,
        session,
      });
      if (!balance.sufficient) {
        throw httpError(409, `Insufficient ${normalizeCurrency(currency)} balance.`);
      }
    }

    const balanceCondition =
      operation === 'debit'
        ? { $gte: normalizedAmount }
        : { $lte: MAX_SAFE_INTEGER - normalizedAmount };
    const wallet = await Wallet.findOneAndUpdate(
      {
        userId: authenticatedUserId,
        [field]: balanceCondition,
      },
      { $inc: { [field]: operation === 'credit' ? normalizedAmount : -normalizedAmount } },
      { new: true, runValidators: true, session },
    );

    if (!wallet) {
      const currentWallet = await Wallet.findOne({ userId: authenticatedUserId })
        .session(session)
        .lean();
      if (!currentWallet) {
        throw httpError(404, 'Wallet not found.');
      }
      if (operation === 'debit') {
        throw httpError(409, `Insufficient ${normalizeCurrency(currency)} balance.`);
      }
      throw httpError(409, 'Wallet balance would exceed the supported integer range.');
    }

    const balanceAfter = wallet[field];
    if (!Number.isSafeInteger(balanceAfter) || balanceAfter < 0) {
      throw new Error('Atomic wallet update returned an invalid balance.');
    }
    const balanceBefore =
      operation === 'credit'
        ? balanceAfter - normalizedAmount
        : balanceAfter + normalizedAmount;

    const ledgerEntry = await createLedgerEntry({
      userId: authenticatedUserId,
      currency,
      type: normalizedType,
      amount: normalizedAmount,
      balanceBefore,
      balanceAfter,
      source,
      referenceId,
      description,
      metadata,
      session,
    });

    await AuditLog.create(
      [
        {
          actorType: normalizedActorId ? 'USER' : 'SYSTEM',
          actorId: normalizedActorId,
          action:
            normalizedType === 'CORRECTION'
              ? 'BALANCE_CORRECTION'
              : operation === 'credit'
                ? 'WALLET_CREDIT'
                : 'WALLET_DEBIT',
          targetUserId: authenticatedUserId,
          targetType: 'WALLET',
          referenceId: referenceId == null ? ledgerEntry.transactionId : referenceId.trim(),
          metadata: {
            transactionId: ledgerEntry.transactionId,
            currency: normalizedCurrency,
            amount: normalizedAmount,
            type: normalizedType,
            source: source.trim(),
          },
          ipAddress: typeof ipAddress === 'string' ? ipAddress.slice(0, 64) : null,
        },
      ],
      { session },
    );

    result = { wallet, transaction: ledgerEntry };
  };

  if (suppliedSession) {
    await execute(suppliedSession);
    return result;
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await execute(session);
    });

    return result;
  } finally {
    await session.endSession();
  }
}

async function creditWallet(options = {}) {
  return mutateWallet({ ...options, operation: 'credit' });
}

async function debitWallet(options = {}) {
  return mutateWallet({ ...options, operation: 'debit' });
}

function parsePage(value, defaultValue, maximum) {
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw httpError(400, 'Invalid transaction pagination.');
  }
  return parsed;
}

async function getTransactions({
  userId,
  page = 1,
  limit = 20,
  currency,
  status,
} = {}) {
  const authenticatedUserId = normalizeUserId(userId);
  const currentPage = parsePage(page, 1, MAX_PAGE);
  const pageSize = parsePage(limit, 20, MAX_LIMIT);
  const filter = { userId: authenticatedUserId };

  if (currency !== undefined) {
    filter.currency = normalizeCurrency(currency);
  }
  if (status !== undefined) {
    if (
      typeof status !== 'string' ||
      !['PENDING', 'COMPLETED', 'FAILED', 'REVERSED'].includes(status.trim().toUpperCase())
    ) {
      throw httpError(400, 'Unsupported transaction status.');
    }
    filter.status = status.trim().toUpperCase();
  }

  const [transactions, total] = await Promise.all([
    WalletTransaction.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((currentPage - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    WalletTransaction.countDocuments(filter),
  ]);

  return {
    transactions,
    pagination: {
      page: currentPage,
      limit: pageSize,
      total,
      pages: Math.ceil(total / pageSize),
    },
  };
}

module.exports = {
  createLedgerEntry,
  creditWallet,
  debitWallet,
  getTransactions,
  getWallet,
  validateBalance,
};
