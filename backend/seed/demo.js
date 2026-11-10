require('dotenv').config();

const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Wallet = require('../src/models/Wallet');
const WalletTransaction = require('../src/models/WalletTransaction');

const DEMO_EMAIL = 'demo@veloop.test';
const DEMO_BALANCES = {
  ves: 25000,
  sves: 5000,
  gems: 100,
  tokens: 500,
  spins: 3,
};
const BCRYPT_ROUNDS = 12;

const DEMO_TRANSACTIONS = [
  {
    transactionId: 'demo-opening-balance-v1',
    type: 'ADMIN_CREDIT',
    amount: 23900,
    balanceBefore: 0,
    balanceAfter: 23900,
    description: 'Demo/test opening VEs balance',
  },
  {
    transactionId: 'demo-ad-reward-v1',
    type: 'AD_REWARD',
    amount: 500,
    balanceBefore: 23900,
    balanceAfter: 24400,
    description: 'Demo ad reward',
  },
  {
    transactionId: 'demo-daily-reward-v1',
    type: 'DAILY_REWARD',
    amount: 100,
    balanceBefore: 24400,
    balanceAfter: 24500,
    description: 'Demo daily reward',
  },
  {
    transactionId: 'demo-referral-reward-v1',
    type: 'REFERRAL',
    amount: 250,
    balanceBefore: 24500,
    balanceAfter: 24750,
    description: 'Demo referral reward',
  },
  {
    transactionId: 'demo-bonus-v1',
    type: 'BONUS',
    amount: 250,
    balanceBefore: 24750,
    balanceAfter: 25000,
    description: 'Demo bonus reward',
  },
];

function getDemoPassword() {
  const password = process.env.DEMO_USER_PASSWORD;
  if (
    !password ||
    Buffer.byteLength(password, 'utf8') < 8 ||
    Buffer.byteLength(password, 'utf8') > 72 ||
    /^(change-this|replace-with)/i.test(password.trim())
  ) {
    throw new Error(
      'Set DEMO_USER_PASSWORD to a private 8-72 byte development password in backend/.env.',
    );
  }

  return password;
}

async function seedDemoData() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Demo seed data must not be written in production.');
  }
  if (process.env.SEED_DEMO_DATA !== 'true') {
    throw new Error('Set SEED_DEMO_DATA=true in backend/.env to confirm a local demo seed.');
  }
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI must be set to a development database.');
  }

  const passwordHash = await bcrypt.hash(getDemoPassword(), BCRYPT_ROUNDS);
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });

  const now = new Date();
  const user = await User.findOneAndUpdate(
    { email: DEMO_EMAIL },
    {
      $setOnInsert: {
        name: 'VELoop Demo User (Test Data)',
        email: DEMO_EMAIL,
        passwordHash,
        accountStatus: 'ACTIVE',
        role: 'USER',
        createdAt: now,
        updatedAt: now,
      },
    },
    { new: true, upsert: true, runValidators: true, timestamps: false },
  );

  await Wallet.findOneAndUpdate(
    { userId: user._id },
    {
      $setOnInsert: {
        userId: user._id,
        ...DEMO_BALANCES,
        createdAt: now,
        updatedAt: now,
      },
    },
    { new: true, upsert: true, runValidators: true, timestamps: false },
  );

  for (const [index, transaction] of DEMO_TRANSACTIONS.entries()) {
    const createdAt = new Date(now.getTime() - (DEMO_TRANSACTIONS.length - index) * 86400000);
    const alreadySeeded = await WalletTransaction.exists({
      transactionId: transaction.transactionId,
    });
    if (!alreadySeeded) {
      try {
        await WalletTransaction.create({
          ...transaction,
          userId: user._id,
          currency: 'VES',
          source: 'DEMO_SEED',
          referenceId: null,
          status: 'COMPLETED',
          metadata: { isDemo: true, seedVersion: 1 },
          createdAt,
          updatedAt: createdAt,
        });
      } catch (error) {
        if (error.code !== 11000) {
          throw error;
        }
      }
    }
  }

  console.log(`Demo/test user and wallet are ready: ${DEMO_EMAIL}`);
  console.log('Seeded wallet balances and demo ledger records without overwriting existing records.');
}

if (require.main === module) {
  seedDemoData()
    .catch((error) => {
      if (error.name === 'Error') {
        console.error(`Demo seed failed: ${error.message}`);
      } else {
        console.error(`Demo seed failed: ${error.name}`);
      }
      process.exitCode = 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    });
}

module.exports = {
  DEMO_BALANCES,
  DEMO_EMAIL,
  DEMO_TRANSACTIONS,
  seedDemoData,
};
