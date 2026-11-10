const mongoose = require('mongoose');

function getHealth(_req, res) {
  res.status(200).json({
    success: true,
    service: 'veloop-wallet-backend',
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
}

function getReadiness(_req, res) {
  const ready = mongoose.connection.readyState === 1;

  res.status(ready ? 200 : 503).json({
    success: ready,
    service: 'veloop-wallet-backend',
    status: ready ? 'ready' : 'unavailable',
    timestamp: new Date().toISOString(),
  });
}

module.exports = { getHealth, getReadiness };
