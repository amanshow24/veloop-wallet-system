const express = require('express');
const rateLimit = require('express-rate-limit');
const authenticate = require('../middleware/authenticate');
const { getCurrentUser, login, register } = require('../controllers/auth.controller');
const {
  validateLogin,
  validateRegistration,
} = require('../validators/auth.validators');

const router = express.Router();
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many authentication attempts. Try again later.',
  },
});

router.use(authRateLimiter);
router.post('/register', validateRegistration, register);
router.post('/login', validateLogin, login);
router.get('/me', authenticate, getCurrentUser);

module.exports = router;
