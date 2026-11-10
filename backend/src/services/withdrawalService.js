const { createHash, randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const PayoutMethod = require('../models/PayoutMethod');
const PayoutOption = require('../models/PayoutOption');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Withdrawal = require('../models/Withdrawal');
const httpError = require('../utils/httpError');
const walletService = require('./walletService');

const WITHDRAWAL_STATUSES = ['PENDING', 'PROCESSING', 'APPROVED', 'REJECTED', 'CANCELLED'];
const ALLOWED_ELIGIBILITY_FIELDS = new Set([
  'accountStatus',
  'allowedRoles',
  'configurationConfirmed',
  'manualReviewRequired',
  'maximumAccountAgeDays',
  'minimumAccountAgeDays',
]);

function assertObjectId(value, message) {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw httpError(400, message);
  }
  return new mongoose.Types.ObjectId(value);
}

function validatePayoutDetails(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw httpError(400, 'payoutDetails must be a plain object.');
  }

  const details = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) {
      throw httpError(400, 'Payout detail field names are invalid.');
    }
    if (
      typeof rawValue !== 'string' ||
      rawValue.trim().length === 0 ||
      rawValue.trim().length > 254 ||
      /[\u0000-\u001f\u007f]/.test(rawValue)
    ) {
      throw httpError(400, `Payout detail "${key}" must be a non-empty string.`);
    }

    const normalized = rawValue.trim();
    if (
      key.toLowerCase() === 'upiid' &&
      !/^[A-Za-z0-9._-]{2,128}@[A-Za-z0-9.-]{2,64}$/.test(normalized)
    ) {
      throw httpError(400, 'A valid UPI ID is required.');
    }
    if (
      key.toLowerCase().includes('email') &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
    ) {
      throw httpError(400, `Payout detail "${key}" must be a valid email address.`);
    }
    details[key] = normalized;
  }
  return details;
}

function createRequestFingerprint({ methodId, optionId, payoutDetails }) {
  const orderedDetails = Object.fromEntries(
    Object.entries(payoutDetails).sort(([first], [second]) => first.localeCompare(second)),
  );
  return createHash('sha256')
    .update(JSON.stringify({ methodId, optionId, payoutDetails: orderedDetails }))
    .digest('hex');
}

function enforceEligibility(eligibility, user) {
  if (!eligibility || typeof eligibility !== 'object' || Array.isArray(eligibility)) {
    throw httpError(409, 'Payout eligibility is not configured.');
  }

  if (Object.keys(eligibility).some((field) => !ALLOWED_ELIGIBILITY_FIELDS.has(field))) {
    throw httpError(409, 'Payout eligibility is not supported by the current configuration.');
  }
  if (eligibility.configurationConfirmed === false) {
    throw httpError(409, 'This payout option is awaiting configuration confirmation.');
  }
  if (
    eligibility.accountStatus !== undefined &&
    eligibility.accountStatus !== user.accountStatus
  ) {
    throw httpError(403, 'Your account is not eligible for this payout option.');
  }
  if (
    Array.isArray(eligibility.allowedRoles) &&
    !eligibility.allowedRoles.includes(user.role)
  ) {
    throw httpError(403, 'Your account is not eligible for this payout option.');
  }
  if (
    eligibility.allowedRoles !== undefined &&
    !Array.isArray(eligibility.allowedRoles)
  ) {
    throw httpError(409, 'Payout role eligibility is not configured correctly.');
  }

  const accountAgeDays = Math.floor(
    (Date.now() - new Date(user.createdAt).getTime()) / (24 * 60 * 60 * 1000),
  );
  if (
    Number.isSafeInteger(eligibility.minimumAccountAgeDays) &&
    accountAgeDays < eligibility.minimumAccountAgeDays
  ) {
    throw httpError(403, 'Your account is not eligible for this payout option.');
  }
  if (
    Number.isSafeInteger(eligibility.maximumAccountAgeDays) &&
    accountAgeDays > eligibility.maximumAccountAgeDays
  ) {
    throw httpError(403, 'Your account is not eligible for this payout option.');
  }
  for (const ageField of ['minimumAccountAgeDays', 'maximumAccountAgeDays']) {
    if (
      eligibility[ageField] !== undefined &&
      (!Number.isSafeInteger(eligibility[ageField]) || eligibility[ageField] < 0)
    ) {
      throw httpError(409, 'Payout account-age eligibility is not configured correctly.');
    }
  }
}

function ensureRequiredPayoutDetails(method, option, payoutDetails) {
  const requiredFields = new Set([
    ...(method.requiredDetails || []),
    ...(option.requiredDetails || []),
  ]);
  const providedFields = Object.keys(payoutDetails);
  const missingField = [...requiredFields].find((field) => !providedFields.includes(field));
  if (missingField) {
    throw httpError(400, `Payout detail "${missingField}" is required.`);
  }
  const unexpectedField = providedFields.find((field) => !requiredFields.has(field));
  if (unexpectedField) {
    throw httpError(400, `Unexpected payout detail field: ${unexpectedField}.`);
  }
}

function addAuditEntry({ actorId, action, userId, withdrawalId, metadata = {}, ipAddress, session }) {
  return AuditLog.create(
    [
      {
        actorId,
        action,
        targetUserId: userId,
        targetType: 'WITHDRAWAL',
        referenceId: withdrawalId,
        metadata,
        ipAddress: typeof ipAddress === 'string' ? ipAddress.slice(0, 64) : null,
      },
    ],
    { session },
  );
}

async function findWithdrawalByIdempotency({ userId, idempotencyKey }) {
  return Withdrawal.findOne({ userId, idempotencyKey })
    .select('+requestFingerprint')
    .lean();
}

async function createWithdrawal({
  userId,
  actorId,
  methodId,
  optionId,
  payoutDetails: rawPayoutDetails,
  idempotencyKey,
  ipAddress,
} = {}) {
  const authenticatedUserId = assertObjectId(userId, 'A valid authenticated user ID is required.');
  if (authenticatedUserId.toString() !== String(actorId)) {
    throw httpError(403, 'You are not authorized to create this withdrawal.');
  }
  const payoutDetails = validatePayoutDetails(rawPayoutDetails);
  const normalizedMethodId =
    typeof methodId === 'string' ? methodId.trim().toLowerCase() : '';
  const normalizedOptionId = typeof optionId === 'string' ? optionId.trim().toLowerCase() : '';
  if (
    !/^[a-z][a-z0-9_]{1,39}$/.test(normalizedMethodId) ||
    !/^[a-z][a-z0-9_]{1,127}$/.test(normalizedOptionId)
  ) {
    throw httpError(400, 'A valid payout method and option are required.');
  }
  if (
    typeof idempotencyKey !== 'string' ||
    !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)
  ) {
    throw httpError(400, 'A valid Idempotency-Key header is required.');
  }

  const requestFingerprint = createRequestFingerprint({
    methodId: normalizedMethodId,
    optionId: normalizedOptionId,
    payoutDetails,
  });
  const session = await mongoose.startSession();
  const withdrawalId = randomUUID();
  let result;

  try {
    await session.withTransaction(async () => {
      const previous = await Withdrawal.findOne({
        userId: authenticatedUserId,
        idempotencyKey,
      })
        .select('+requestFingerprint')
        .session(session)
        .lean();
      if (previous) {
        if (previous.requestFingerprint !== requestFingerprint) {
          throw httpError(409, 'This Idempotency-Key was already used for a different request.');
        }
        result = { withdrawal: previous, replayed: true };
        return;
      }

      const user = await User.findById(authenticatedUserId)
        .select('_id role accountStatus createdAt')
        .session(session)
        .lean();
      if (!user || user.accountStatus !== 'ACTIVE') {
        throw httpError(403, 'Account is not eligible to create a withdrawal.');
      }

      const method = await PayoutMethod.findOne({ methodId: normalizedMethodId })
        .session(session)
        .lean();
      if (!method || !method.active || method.availability !== 'AVAILABLE') {
        throw httpError(409, 'This payout method is currently unavailable.');
      }
      const option = await PayoutOption.findOne({
        methodId: normalizedMethodId,
        optionId: normalizedOptionId,
      })
        .session(session)
        .lean();
      if (!option || !option.active || option.availability !== 'AVAILABLE') {
        throw httpError(409, 'Selected payout option is unavailable.');
      }

      enforceEligibility(method.eligibility, user);
      enforceEligibility(option.eligibility, user);
      ensureRequiredPayoutDetails(method, option, payoutDetails);

      if (
        option.methodId !== method.methodId ||
        !Number.isSafeInteger(option.requiredAmount) ||
        option.requiredAmount <= 0 ||
        !Number.isSafeInteger(option.payoutAmount) ||
        option.payoutAmount <= 0 ||
        typeof option.payoutCurrency !== 'string' ||
        !/^[A-Z]{3}$/.test(option.payoutCurrency)
      ) {
        throw httpError(409, 'Selected payout option is not configured correctly.');
      }

      const wallet = await Wallet.findOne({ userId: authenticatedUserId })
        .session(session)
        .lean();
      if (!wallet) {
        throw httpError(404, 'Wallet not found.');
      }

      const initialStatusHistory = [
        {
          status: 'PENDING',
          changedBy: authenticatedUserId,
          changedAt: new Date(),
        },
      ];
      const [withdrawal] = await Withdrawal.create(
        [
          {
            withdrawalId,
            userId: authenticatedUserId,
            idempotencyKey,
            requestFingerprint,
            method: normalizedMethodId,
            optionId: normalizedOptionId,
            currency: option.currency,
            currencyAmount: option.requiredAmount,
            payoutAmount: option.payoutAmount,
            payoutCurrency: option.payoutCurrency,
            payoutDetails,
            status: 'PENDING',
            requestedAt: new Date(),
            statusHistory: initialStatusHistory,
          },
        ],
        { session },
      );

      const debit = await walletService.debitWallet({
        userId: authenticatedUserId,
        actorId: authenticatedUserId,
        currency: option.currency,
        amount: option.requiredAmount,
        type: 'WITHDRAWAL',
        source: 'WITHDRAWAL',
        referenceId: withdrawalId,
        description: `Withdrawal request ${withdrawalId}`,
        metadata: { withdrawalId, method: normalizedMethodId, optionId: normalizedOptionId },
        ipAddress,
        session,
      });

      withdrawal.transactionId = debit.transaction.transactionId;
      await withdrawal.save({ session });
      await addAuditEntry({
        actorId: authenticatedUserId,
        action: 'WITHDRAWAL_CREATED',
        userId: authenticatedUserId,
        withdrawalId,
        metadata: {
          method: normalizedMethodId,
          optionId: normalizedOptionId,
          currency: option.currency,
          currencyAmount: option.requiredAmount,
          transactionId: debit.transaction.transactionId,
        },
        ipAddress,
        session,
      });

      result = { withdrawal, replayed: false };
    });
    return result;
  } catch (error) {
    if (error.code === 11000) {
      const existing = await findWithdrawalByIdempotency({
        userId: authenticatedUserId,
        idempotencyKey,
      });
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) {
          throw httpError(409, 'This Idempotency-Key was already used for a different request.');
        }
        return { withdrawal: existing, replayed: true };
      }
      throw httpError(409, 'Withdrawal request conflicts with an existing record.');
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

function parsePage(value, defaultValue, maximum) {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw httpError(400, 'Invalid withdrawal pagination.');
  }
  return parsed;
}

async function getWithdrawals({ userId, page = 1, limit = 20, status } = {}) {
  const authenticatedUserId = assertObjectId(userId, 'A valid authenticated user ID is required.');
  const currentPage = parsePage(page, 1, 1000000);
  const pageSize = parsePage(limit, 20, 100);
  const filter = { userId: authenticatedUserId };
  if (status !== undefined) {
    const normalizedStatus = typeof status === 'string' ? status.trim().toUpperCase() : '';
    if (!WITHDRAWAL_STATUSES.includes(normalizedStatus)) {
      throw httpError(400, 'Unsupported withdrawal status.');
    }
    filter.status = normalizedStatus;
  }
  const [withdrawals, total] = await Promise.all([
    Withdrawal.find(filter)
      .sort({ requestedAt: -1, _id: -1 })
      .skip((currentPage - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    Withdrawal.countDocuments(filter),
  ]);
  return {
    withdrawals,
    pagination: {
      page: currentPage,
      limit: pageSize,
      total,
      pages: Math.ceil(total / pageSize),
    },
  };
}

async function getWithdrawal({ userId, withdrawalId } = {}) {
  const authenticatedUserId = assertObjectId(userId, 'A valid authenticated user ID is required.');
  if (typeof withdrawalId !== 'string') {
    throw httpError(400, 'A valid withdrawal ID is required.');
  }
  const withdrawal = await Withdrawal.findOne({
    withdrawalId,
    userId: authenticatedUserId,
  }).lean();
  if (!withdrawal) {
    throw httpError(404, 'Withdrawal not found.');
  }
  return withdrawal;
}

const TRANSITIONS = {
  process: {
    from: ['PENDING'],
    to: 'PROCESSING',
    action: 'WITHDRAWAL_PROCESSING',
  },
  approve: {
    from: ['PROCESSING'],
    to: 'APPROVED',
    action: 'WITHDRAWAL_APPROVED',
  },
  reject: {
    from: ['PENDING', 'PROCESSING'],
    to: 'REJECTED',
    action: 'WITHDRAWAL_REJECTED',
  },
};

async function transitionWithdrawal({
  withdrawalId,
  actorId,
  action,
  reviewNote,
  reason,
  ipAddress,
} = {}) {
  const normalizedActorId = assertObjectId(actorId, 'A valid authenticated user ID is required.');
  const transition = TRANSITIONS[action];
  if (!transition || typeof withdrawalId !== 'string') {
    throw httpError(400, 'Invalid withdrawal status operation.');
  }
  if (
    action === 'reject' &&
    (typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 1000)
  ) {
    throw httpError(400, 'A rejection reason between 3 and 1000 characters is required.');
  }

  const session = await mongoose.startSession();
  let updatedWithdrawal;
  try {
    await session.withTransaction(async () => {
      const current = await Withdrawal.findOne({ withdrawalId })
        .session(session)
        .lean();
      if (!current) {
        throw httpError(404, 'Withdrawal not found.');
      }
      if (!transition.from.includes(current.status)) {
        throw httpError(409, `Withdrawal cannot transition from ${current.status} to ${transition.to}.`);
      }

      const update = {
        $set: { status: transition.to },
        $push: {
          statusHistory: {
            status: transition.to,
            changedBy: normalizedActorId,
            note: action === 'reject' ? reason.trim() : reviewNote || null,
            changedAt: new Date(),
          },
        },
      };
      if (action === 'approve' || action === 'reject') {
        update.$set.processedAt = new Date();
        update.$set.processedBy = normalizedActorId;
      }
      if (reviewNote) {
        update.$set.reviewNote = reviewNote;
      }
      if (action === 'reject') {
        update.$set.rejectionReason = reason.trim();
      }

      updatedWithdrawal = await Withdrawal.findOneAndUpdate(
        { withdrawalId, status: { $in: transition.from } },
        update,
        { new: true, runValidators: true, session },
      );
      if (!updatedWithdrawal) {
        throw httpError(409, 'Withdrawal status changed; reload and try again.');
      }

      let reversalTransactionId;
      if (action === 'reject') {
        const reversal = await walletService.creditWallet({
          userId: current.userId,
          actorId: normalizedActorId,
          currency: current.currency,
          amount: current.currencyAmount,
          type: 'ADMIN_CREDIT',
          source: 'WITHDRAWAL_REVERSAL',
          referenceId: `${current.withdrawalId}:reversal`,
          description: `Reversal for rejected withdrawal ${current.withdrawalId}`,
          metadata: { withdrawalId: current.withdrawalId },
          ipAddress,
          session,
        });
        reversalTransactionId = reversal.transaction.transactionId;
      }

      await addAuditEntry({
        actorId: normalizedActorId,
        action: transition.action,
        userId: current.userId,
        withdrawalId: current.withdrawalId,
        metadata: {
          fromStatus: current.status,
          toStatus: transition.to,
          ...(action === 'reject' ? { reason: reason.trim(), reversalTransactionId } : {}),
          ...(reviewNote ? { reviewNote } : {}),
        },
        ipAddress,
        session,
      });
    });
    return updatedWithdrawal;
  } finally {
    await session.endSession();
  }
}

module.exports = {
  createWithdrawal,
  getWithdrawal,
  getWithdrawals,
  transitionWithdrawal,
};
