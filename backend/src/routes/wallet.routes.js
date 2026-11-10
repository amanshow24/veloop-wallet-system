const express = require('express');
const authenticate = require('../middleware/authenticate');
const authorizeRoles = require('../middleware/authorize');
const {
  createMutationHandler,
  getWallet,
  getWalletSummary,
  getWalletTransactions,
} = require('../controllers/wallet.controller');
const {
  validateEmptyQuery,
  validateMutation,
  validateTransactionQuery,
} = require('../validators/wallet.validators');

const router = express.Router();
const authorizeWalletMutation = authorizeRoles('ADMIN', 'INTERNAL');

router.use(authenticate);
router.get('/summary', validateEmptyQuery, getWalletSummary);
router.get('/transactions', validateTransactionQuery, getWalletTransactions);
router.get('/', validateEmptyQuery, getWallet);
router.post(
  '/credit',
  authorizeWalletMutation,
  validateEmptyQuery,
  validateMutation('credit'),
  createMutationHandler('credit'),
);
router.post(
  '/debit',
  authorizeWalletMutation,
  validateEmptyQuery,
  validateMutation('debit'),
  createMutationHandler('debit'),
);

module.exports = router;
