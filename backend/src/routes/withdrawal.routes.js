const express = require('express');
const rateLimit = require('express-rate-limit');
const authenticate = require('../middleware/authenticate');
const authorizeRoles = require('../middleware/authorize');
const {
  createWithdrawal,
  getWithdrawal,
  getWithdrawals,
  transitionWithdrawal,
} = require('../controllers/withdrawal.controller');
const {
  validateCreateWithdrawal,
  validateEmptyQuery,
  validateTransition,
  validateWithdrawalId,
  validateWithdrawalListQuery,
} = require('../validators/withdrawal.validators');

const router = express.Router();
const withdrawalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many withdrawal requests. Try again later.',
  },
});
const reviewRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many withdrawal review requests. Try again later.',
  },
});
const authorizeWithdrawalReview = authorizeRoles('ADMIN', 'INTERNAL');

router.use(authenticate);
router.post('/', withdrawalRateLimiter, validateEmptyQuery, validateCreateWithdrawal, createWithdrawal);
router.get('/', validateWithdrawalListQuery, getWithdrawals);
router.get('/:withdrawalId', validateEmptyQuery, validateWithdrawalId, getWithdrawal);
router.patch(
  '/:withdrawalId/process',
  authorizeWithdrawalReview,
  reviewRateLimiter,
  validateEmptyQuery,
  validateWithdrawalId,
  validateTransition('process'),
  transitionWithdrawal('process'),
);
router.patch(
  '/:withdrawalId/approve',
  authorizeWithdrawalReview,
  reviewRateLimiter,
  validateEmptyQuery,
  validateWithdrawalId,
  validateTransition('approve'),
  transitionWithdrawal('approve'),
);
router.patch(
  '/:withdrawalId/reject',
  authorizeWithdrawalReview,
  reviewRateLimiter,
  validateEmptyQuery,
  validateWithdrawalId,
  validateTransition('reject'),
  transitionWithdrawal('reject'),
);

module.exports = router;
