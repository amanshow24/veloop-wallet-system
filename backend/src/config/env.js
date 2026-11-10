require('dotenv').config();

const mongoUri = process.env.MONGO_URI;
const jwtIssuer = 'veloop-wallet-api';
const jwtAudience = 'veloop-wallet-client';
const port = process.env.PORT === undefined ? 5000 : Number(process.env.PORT);

function getTrustProxyHops() {
  const value = process.env.TRUST_PROXY_HOPS;
  if (value === undefined) {
    return 0;
  }
  if (!/^(?:0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error('TRUST_PROXY_HOPS must be a nonnegative integer.');
  }
  return Number(value);
}

const trustProxyHops = getTrustProxyHops();

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (
    !secret ||
    secret.trim().length < 32 ||
    /^(replace-with|your-unique|change-this)/i.test(secret.trim())
  ) {
    throw new Error('JWT_SECRET must be a unique secret of at least 32 characters.');
  }

  return secret;
}

function validateEnvironment() {
  if (!mongoUri) {
    throw new Error('MONGO_URI must be set before starting the API.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  getJwtSecret();
}

module.exports = {
  port,
  trustProxyHops,
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  apiPrefix: '/api',
  mongoUri,
  jwtAudience,
  jwtIssuer,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  getJwtSecret,
  validateEnvironment,
};
