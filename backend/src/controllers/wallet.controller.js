const walletService = require('../services/walletService');

function serializeWallet(wallet) {
  return {
    id: wallet._id.toString(),
    ves: wallet.ves,
    sves: wallet.sves,
    gems: wallet.gems,
    tokens: wallet.tokens,
    spins: wallet.spins,
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
  };
}

async function getWallet(req, res, next) {
  try {
    const wallet = await walletService.getWallet(req.auth.userId);
    res.status(200).json({ success: true, wallet: serializeWallet(wallet) });
  } catch (error) {
    next(error);
  }
}

async function getWalletSummary(req, res, next) {
  try {
    const wallet = await walletService.getWallet(req.auth.userId);
    res.status(200).json({
      success: true,
      summary: {
        balances: {
          ves: wallet.ves,
          sves: wallet.sves,
          gems: wallet.gems,
          tokens: wallet.tokens,
          spins: wallet.spins,
        },
        lastUpdated: wallet.updatedAt,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function getWalletTransactions(req, res, next) {
  try {
    const result = await walletService.getTransactions({
      userId: req.auth.userId,
      ...req.validatedQuery,
    });
    res.status(200).json({
      success: true,
      transactions: result.transactions,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
}

function createMutationHandler(operation) {
  return async (req, res, next) => {
    try {
      const { targetUserId, ...details } = req.validatedBody;
      const mutation =
        operation === 'credit'
          ? await walletService.creditWallet({
              userId: targetUserId,
              actorId: req.auth.userId,
              ipAddress: req.ip,
              ...details,
            })
          : await walletService.debitWallet({
              userId: targetUserId,
              actorId: req.auth.userId,
              ipAddress: req.ip,
              ...details,
            });

      res.status(201).json({
        success: true,
        wallet: serializeWallet(mutation.wallet),
        transaction: mutation.transaction,
      });
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  createMutationHandler,
  getWallet,
  getWalletSummary,
  getWalletTransactions,
  serializeWallet,
};
