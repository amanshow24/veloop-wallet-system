const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { TRANSACTION_TYPES, WALLET_CURRENCIES } = require('./constants');
const { isPlainObject, objectField, safeIntegerField } = require('./schemaFields');

const walletTransactionSchema = new mongoose.Schema(
  {
    transactionId: {
      type: String,
      required: true,
      unique: true,
      default: randomUUID,
      trim: true,
      maxlength: 64,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    currency: {
      type: String,
      enum: WALLET_CURRENCIES,
      required: true,
    },
    type: {
      type: String,
      enum: TRANSACTION_TYPES,
      required: true,
    },
    amount: safeIntegerField({ min: 1 }),
    balanceBefore: safeIntegerField(),
    balanceAfter: safeIntegerField(),
    source: {
      type: String,
      required: true,
      trim: true,
      maxlength: 64,
    },
    referenceId: {
      type: String,
      default: null,
      trim: true,
      maxlength: 128,
      index: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'COMPLETED', 'FAILED', 'REVERSED'],
      default: 'COMPLETED',
      required: true,
      index: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    metadata: {
      ...objectField(),
      type: mongoose.Schema.Types.Mixed,
    },
  },
  { timestamps: true },
);

walletTransactionSchema.index({ userId: 1, createdAt: -1 });
walletTransactionSchema.index({ userId: 1, status: 1, createdAt: -1 });
walletTransactionSchema.index(
  { source: 1, referenceId: 1 },
  { unique: true, partialFilterExpression: { source: 'WITHDRAWAL_REVERSAL' } },
);

walletTransactionSchema.path('metadata').validate(isPlainObject, 'metadata must be a plain object.');

walletTransactionSchema.pre('save', function rejectExistingLedgerSave() {
  if (!this.isNew) {
    throw new Error('Wallet transaction ledger records are append-only.');
  }
});

walletTransactionSchema.pre('deleteOne', { document: true, query: false }, function rejectDocumentDelete() {
  throw new Error('Wallet transaction ledger records are append-only.');
});

for (const operation of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
]) {
  walletTransactionSchema.pre(operation, function rejectLedgerMutation() {
    throw new Error('Wallet transaction ledger records are append-only.');
  });
}

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema);
