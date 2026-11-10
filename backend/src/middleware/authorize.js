const httpError = require('../utils/httpError');

function authorizeRoles(...allowedRoles) {
  return (req, _res, next) => {
    if (!req.auth) {
      return next(httpError(401, 'Authentication required.'));
    }
    if (!allowedRoles.includes(req.auth.role)) {
      return next(httpError(403, 'You are not authorized to perform this action.'));
    }

    next();
  };
}

module.exports = authorizeRoles;
