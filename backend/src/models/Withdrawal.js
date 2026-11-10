const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { WALLET_CURRENCIES } = require('./constants');
const { isPlainObject, objectField, safeIntegerField } = require('./schemaFields');

const withdrawalSchema = new mongoose.Schema(
  {
    withdrawalId: {
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
    idempotencyKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
    },
    requestFingerprint: {
      type: String,
      required: true,
      match: /^[a-f0-9]{64}$/,
      select: false,
    },
    method: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: /^[a-z][a-z0-9_]{1,39}$/,
    },
    optionId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
      index: true,
    },
    currency: {
      type: String,
      enum: WALLET_CURRENCIES,
      required: true,
    },
    currencyAmount: safeIntegerField({ min: 1 }),
    payoutAmount: safeIntegerField({ min: 1 }),
    payoutCurrency: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      match: /^[A-Z]{3}$/,
    },
    payoutDetails: {
      ...objectField({ required: true }),
      type: mongoose.Schema.Types.Mixed,
    },
    status: {
      type: String,
      enum: ['PENDING', 'PROCESSING', 'APPROVED', 'REJECTED', 'CANCELLED'],
      default: 'PENDING',
      required: true,
      index: true,
    },
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
    reviewNote: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
    },
    transactionId: {
      type: String,
      trim: true,
      maxlength: 64,
      default: null,
      index: true,
    },
    requestedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    statusHistory: {
      type: [
        new mongoose.Schema(
          {
            status: {
              type: String,
              enum: ['PENDING', 'PROCESSING', 'APPROVED', 'REJECTED', 'CANCELLED'],
              required: true,
            },
            changedBy: {
              type: mongoose.Schema.Types.ObjectId,
              ref: 'User',
              required: true,
            },
            note: { type: String, trim: true, maxlength: 1000, default: null },
            changedAt: { type: Date, required: true, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true },
);

withdrawalSchema.index({ userId: 1, requestedAt: -1 });
withdrawalSchema.index({ status: 1, requestedAt: -1 });
withdrawalSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
withdrawalSchema.path('payoutDetails').validate(isPlainObject, 'payoutDetails must be a plain object.');

module.exports = mongoose.model('Withdrawal', withdrawalSchema);
