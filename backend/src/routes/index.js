const express = require('express');
const authRoutes = require('./auth.routes');
const healthRoutes = require('./health.routes');
const payoutRoutes = require('./payout.routes');
const walletRoutes = require('./wallet.routes');
const withdrawalRoutes = require('./withdrawal.routes');

const router = express.Router();

router.use(healthRoutes);
router.use('/auth', authRoutes);
router.use('/wallet', walletRoutes);
router.use('/payout', payoutRoutes);
router.use('/withdrawals', withdrawalRoutes);

module.exports = router;
