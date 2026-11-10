const withdrawalService = require('../services/withdrawalService');

function serializeWithdrawal(withdrawal) {
  return {
    withdrawalId: withdrawal.withdrawalId,
    userId: withdrawal.userId?.toString?.() || withdrawal.userId,
    method: withdrawal.method,
    optionId: withdrawal.optionId,
    currency: withdrawal.currency,
    currencyAmount: withdrawal.currencyAmount,
    payoutAmount: withdrawal.payoutAmount,
    payoutCurrency: withdrawal.payoutCurrency,
    payoutDetails: withdrawal.payoutDetails,
    status: withdrawal.status,
    rejectionReason: withdrawal.rejectionReason,
    reviewNote: withdrawal.reviewNote,
    transactionId: withdrawal.transactionId,
    requestedAt: withdrawal.requestedAt,
    processedAt: withdrawal.processedAt,
    processedBy: withdrawal.processedBy?.toString?.() || withdrawal.processedBy,
    statusHistory: withdrawal.statusHistory,
    createdAt: withdrawal.createdAt,
    updatedAt: withdrawal.updatedAt,
  };
}

async function createWithdrawal(req, res, next) {
  try {
    const result = await withdrawalService.createWithdrawal({
      ...req.validatedBody,
      userId: req.auth.userId,
      actorId: req.auth.userId,
      ipAddress: req.ip,
    });
    res.status(result.replayed ? 200 : 201).json({
      success: true,
      replayed: result.replayed,
      withdrawal: serializeWithdrawal(result.withdrawal),
    });
  } catch (error) {
    next(error);
  }
}

async function getWithdrawals(req, res, next) {
  try {
    const result = await withdrawalService.getWithdrawals({
      userId: req.auth.userId,
      ...req.validatedQuery,
    });
    res.status(200).json({
      success: true,
      withdrawals: result.withdrawals.map(serializeWithdrawal),
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
}

async function getWithdrawal(req, res, next) {
  try {
    const withdrawal = await withdrawalService.getWithdrawal({
      userId: req.auth.userId,
      withdrawalId: req.params.withdrawalId,
    });
    res.status(200).json({ success: true, withdrawal: serializeWithdrawal(withdrawal) });
  } catch (error) {
    next(error);
  }
}

function transitionWithdrawal(action) {
  return async (req, res, next) => {
    try {
      const withdrawal = await withdrawalService.transitionWithdrawal({
        withdrawalId: req.params.withdrawalId,
        actorId: req.auth.userId,
        action,
        ...req.validatedBody,
        ipAddress: req.ip,
      });
      res.status(200).json({ success: true, withdrawal: serializeWithdrawal(withdrawal) });
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  createWithdrawal,
  getWithdrawal,
  getWithdrawals,
  serializeWithdrawal,
  transitionWithdrawal,
};
