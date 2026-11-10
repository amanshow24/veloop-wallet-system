const app = require('./app');
const connectToDatabase = require('./config/database');
const { port, validateEnvironment } = require('./config/env');
const mongoose = require('mongoose');
const AuditLog = require('./models/AuditLog');
const PayoutMethod = require('./models/PayoutMethod');
const PayoutOption = require('./models/PayoutOption');
const User = require('./models/User');
const Wallet = require('./models/Wallet');
const WalletTransaction = require('./models/WalletTransaction');
const Withdrawal = require('./models/Withdrawal');

const models = [
  AuditLog,
  PayoutMethod,
  PayoutOption,
  User,
  Wallet,
  WalletTransaction,
  Withdrawal,
];

async function startServer() {
  validateEnvironment();
  await connectToDatabase();
  await Promise.all(models.map((model) => model.init()));

  const server = app.listen(port, () => {
    console.log(`VELoop wallet API listening on port ${port}`);
  });

  let shuttingDown = false;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      if (shuttingDown) {
        return;
      }

      shuttingDown = true;
      console.log(`Received ${signal}; shutting down.`);
      const shutdownTimeout = setTimeout(() => {
        console.error('Graceful shutdown timed out.');
        process.exit(1);
      }, 10000);
      shutdownTimeout.unref();

      server.close((error) => {
        if (error) {
          console.error('Unable to close the API server cleanly:', error.name);
          process.exitCode = 1;
        }

        mongoose
          .disconnect()
          .catch((disconnectError) => {
            console.error(
              'Unable to close the MongoDB connection cleanly:',
              disconnectError.name,
            );
            process.exitCode = 1;
          })
          .finally(() => clearTimeout(shutdownTimeout));
      });
    });
  }
}

startServer().catch(async (error) => {
  console.error('Unable to start the API. Check MONGO_URI and JWT_SECRET configuration.');
  console.error(error.name);
  try {
    await mongoose.disconnect();
  } catch (disconnectError) {
    console.error('Unable to close the MongoDB connection cleanly:', disconnectError.name);
  }
  process.exitCode = 1;
});
