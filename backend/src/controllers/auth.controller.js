const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const {
  getJwtSecret,
  jwtAudience,
  jwtExpiresIn,
  jwtIssuer,
} = require('../config/env');
const httpError = require('../utils/httpError');

const BCRYPT_ROUNDS = 12;

function serializeUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    accountStatus: user.accountStatus,
    role: user.role,
  };
}

function createToken(userId) {
  return jwt.sign({}, getJwtSecret(), {
    algorithm: 'HS256',
    subject: userId,
    audience: jwtAudience,
    issuer: jwtIssuer,
    expiresIn: jwtExpiresIn,
  });
}

async function register(req, res, next) {
  let session;
  try {
    session = await mongoose.startSession();
    const { name, email, password } = req.validatedBody;
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = new User({ name, email, passwordHash });

    await session.withTransaction(async () => {
      await user.save({ session });
      const wallet = new Wallet({ userId: user._id });
      await wallet.save({ session });
    });

    res.status(201).json({
      success: true,
      user: serializeUser(user),
      token: createToken(user._id.toString()),
    });
  } catch (error) {
    next(error);
  } finally {
    if (session) {
      await session.endSession();
    }
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.validatedBody;
    const user = await User.findOne({ email }).select('+passwordHash');

    if (!user || !(await user.comparePassword(password))) {
      return next(httpError(401, 'Invalid email or password.'));
    }
    if (user.accountStatus !== 'ACTIVE') {
      return next(httpError(403, 'Account is not active.'));
    }

    res.status(200).json({
      success: true,
      user: serializeUser(user),
      token: createToken(user._id.toString()),
    });
  } catch (error) {
    next(error);
  }
}

function getCurrentUser(req, res) {
  res.status(200).json({
    success: true,
    user: serializeUser(req.user),
  });
}

module.exports = { createToken, getCurrentUser, login, register, serializeUser };
