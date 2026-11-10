const express = require('express');
const authenticate = require('../middleware/authenticate');
const { getPayoutMethods, getPayoutOptions } = require('../controllers/payout.controller');
const { validateEmptyQuery, validateOptionsQuery } = require('../validators/payout.validators');

const router = express.Router();

router.use(authenticate);
router.get('/methods', validateEmptyQuery, getPayoutMethods);
router.get('/options/', validateOptionsQuery, getPayoutOptions);

module.exports = router;
