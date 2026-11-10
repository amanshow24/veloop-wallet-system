const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getJwtSecret, jwtAudience, jwtIssuer } = require('../config/env');
const httpError = require('../utils/httpError');

async function authenticate(req, _res, next) {
  const authorization = req.get('authorization');
  const match = authorization && authorization.match(/^Bearer\s+(\S+)$/i);

  if (!match) {
    return next(httpError(401, 'Authentication required.'));
  }

  let claims;
  try {
    claims = jwt.verify(match[1], getJwtSecret(), {
      algorithms: ['HS256'],
      audience: jwtAudience,
      issuer: jwtIssuer,
    });
  } catch (_error) {
    return next(httpError(401, 'Invalid or expired authentication token.'));
  }

  if (!claims || typeof claims.sub !== 'string') {
    return next(httpError(401, 'Invalid or expired authentication token.'));
  }

  try {
    const user = await User.findById(claims.sub);
    if (!user) {
      return next(httpError(401, 'Invalid or expired authentication token.'));
    }
    if (user.accountStatus !== 'ACTIVE') {
      return next(httpError(403, 'Account is not active.'));
    }

    req.user = user;
    req.auth = {
      userId: user._id.toString(),
      role: user.role,
    };
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = authenticate;
