require('dotenv').config();

const { isDeepStrictEqual } = require('node:util');
const mongoose = require('mongoose');
const AuditLog = require('../src/models/AuditLog');
const PayoutMethod = require('../src/models/PayoutMethod');
const PayoutOption = require('../src/models/PayoutOption');

const PAYOUT_METHODS = [
  {
    methodId: 'upi',
    name: 'UPI',
    type: 'UPI',
    active: true,
    availability: 'AVAILABLE',
    eligibility: {
      accountStatus: 'ACTIVE',
      configurationConfirmed: true,
      manualReviewRequired: true,
    },
    metadata: {
      source: 'ASSIGNMENT_REFERENCE',
      referenceOnly: true,
      note: 'Enabled for the assignment demonstration; no payment service is connected.',
    },
    requiredDetails: ['upiId'],
  },
  {
    methodId: 'paypal',
    name: 'PayPal',
    type: 'PAYPAL',
    active: false,
    availability: 'UNAVAILABLE',
    requiredDetails: [],
  },
  {
    methodId: 'amazon',
    name: 'Amazon Gift Card',
    type: 'AMAZON_GIFT_CARD',
    active: false,
    availability: 'UNAVAILABLE',
    requiredDetails: [],
  },
  {
    methodId: 'google_play',
    name: 'Google Play Gift Card',
    type: 'GOOGLE_PLAY_GIFT_CARD',
    active: false,
    availability: 'UNAVAILABLE',
    requiredDetails: [],
  },
].map((method) => ({
  ...method,
  eligibility:
    method.eligibility || {
      accountStatus: 'ACTIVE',
      configurationConfirmed: false,
      manualReviewRequired: true,
    },
  metadata:
    method.metadata || {
      source: 'ASSIGNMENT_REFERENCE',
      note: 'Options and eligibility have not been confirmed for this method.',
    },
}));

const UPI_REFERENCE_VALUES = [
  { payoutAmount: 10, requiredAmount: 2400 },
  { payoutAmount: 25, requiredAmount: 5800 },
  { payoutAmount: 50, requiredAmount: 10000 },
  { payoutAmount: 100, requiredAmount: 19500 },
  { payoutAmount: 150, requiredAmount: 28500 },
  { payoutAmount: 300, requiredAmount: 52500 },
  { payoutAmount: 500, requiredAmount: 80500 },
  { payoutAmount: 1000, requiredAmount: 150000 },
].map(({ payoutAmount, requiredAmount }) => ({
  optionId: `upi_inr_${payoutAmount}_reference`,
  methodId: 'upi',
  name: `INR ${payoutAmount} UPI redemption (assignment reference)`,
  type: 'UPI',
  currency: 'VES',
  requiredAmount,
  payoutAmount,
  payoutCurrency: 'INR',
  active: true,
  availability: 'AVAILABLE',
  eligibility: {
    accountStatus: 'ACTIVE',
    configurationConfirmed: true,
    manualReviewRequired: true,
  },
  requiredDetails: ['upiId'],
  metadata: {
    source: 'ASSIGNMENT_REFERENCE',
    referenceOnly: true,
    note: 'Enabled for the assignment demonstration; no payment service is connected.',
  },
}));

function assertDevelopmentDatabase(uri, expectedDatabaseName) {
  let databaseName;
  try {
    databaseName = decodeURIComponent(new URL(uri).pathname.slice(1));
  } catch {
    throw new Error('MONGO_URI must point to a dedicated development or test database.');
  }
  if (!/(?:^|[_-])(dev|development|test)$/i.test(databaseName)) {
    throw new Error('Payout reference data may only be seeded into a development or test database.');
  }
  if (expectedDatabaseName && databaseName !== expectedDatabaseName) {
    throw new Error('MONGO_URI does not match the explicitly selected payout database.');
  }
}

async function upsertPayoutConfiguration({
  model,
  identityField,
  identity,
  targetType,
  configuration,
  now,
  session,
}) {
  const filter = { [identityField]: identity };
  const existing = await model.findOne(filter).session(session).lean();
  const changed =
    !existing ||
    Object.entries(configuration).some(
      ([field, value]) => !isDeepStrictEqual(existing[field], value),
    );

  await model.findOneAndUpdate(
    filter,
    {
      $set: { ...configuration, updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { new: true, upsert: true, runValidators: true, timestamps: false, session },
  );

  if (!changed) {
    return false;
  }

  await AuditLog.create(
    [
      {
        actorType: 'SYSTEM',
        action: 'PAYOUT_CONFIGURATION_CHANGED',
        targetType,
        referenceId: identity,
        metadata: {
          resourceType: targetType,
          [identityField]: identity,
          active: configuration.active,
          availability: configuration.availability,
          source: configuration.metadata?.source || 'ASSIGNMENT_REFERENCE',
          ...(configuration.currency ? { currency: configuration.currency } : {}),
          ...(configuration.requiredAmount
            ? { requiredAmount: configuration.requiredAmount }
            : {}),
          ...(configuration.payoutAmount ? { payoutAmount: configuration.payoutAmount } : {}),
          ...(configuration.payoutCurrency
            ? { payoutCurrency: configuration.payoutCurrency }
            : {}),
        },
      },
    ],
    { session },
  );
  return true;
}

async function seedPayoutReference() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Assignment reference payout data must not be seeded in production.');
  }
  if (process.env.SEED_PAYOUT_REFERENCE_VALUES !== 'true') {
    throw new Error(
      'Set SEED_PAYOUT_REFERENCE_VALUES=true to activate assignment reference payout data.',
    );
  }
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI must be set to a dedicated development or test database.');
  }
  assertDevelopmentDatabase(
    process.env.MONGO_URI,
    process.env.PAYOUT_REFERENCE_DATABASE,
  );

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  } else if (mongoose.connection.readyState !== 1) {
    throw new Error('MongoDB is not ready to seed payout configuration.');
  }

  const now = new Date();
  const session = await mongoose.startSession();
  let auditEntryCount = 0;
  try {
    await session.withTransaction(async () => {
      auditEntryCount = 0;
      for (const { methodId, ...configuration } of PAYOUT_METHODS) {
        if (
          await upsertPayoutConfiguration({
            model: PayoutMethod,
            identityField: 'methodId',
            identity: methodId,
            targetType: 'PAYOUT_METHOD',
            configuration,
            now,
            session,
          })
        ) {
          auditEntryCount += 1;
        }
      }

      for (const { optionId, ...configuration } of UPI_REFERENCE_VALUES) {
        if (
          await upsertPayoutConfiguration({
            model: PayoutOption,
            identityField: 'optionId',
            identity: optionId,
            targetType: 'PAYOUT_OPTION',
            configuration,
            now,
            session,
          })
        ) {
          auditEntryCount += 1;
        }
      }
    });
  } finally {
    await session.endSession();
  }

  console.log(
    `Configured ${PAYOUT_METHODS.length} payout methods and ${UPI_REFERENCE_VALUES.length} UPI assignment reference options; recorded ${auditEntryCount} configuration audit events. UPI is available; other methods remain unavailable.`,
  );
}

if (require.main === module) {
  seedPayoutReference()
    .catch((error) => {
      if (error.name === 'Error') {
        console.error(`Payout reference seed failed: ${error.message}`);
      } else {
        console.error(`Payout reference seed failed: ${error.name}`);
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
  PAYOUT_METHODS,
  UPI_REFERENCE_VALUES,
  assertDevelopmentDatabase,
  seedPayoutReference,
  upsertPayoutConfiguration,
};
