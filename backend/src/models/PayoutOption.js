const mongoose = require('mongoose');
const { WALLET_CURRENCIES } = require('./constants');
const { isPlainObject, objectField, safeIntegerField } = require('./schemaFields');

const payoutOptionSchema = new mongoose.Schema(
  {
    optionId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: /^[a-z][a-z0-9_]{1,127}$/,
    },
    methodId: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: /^[a-z][a-z0-9_]{1,39}$/,
      index: true,
      ref: 'PayoutMethod',
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    type: {
      type: String,
      enum: ['UPI', 'PAYPAL', 'AMAZON_GIFT_CARD', 'GOOGLE_PLAY_GIFT_CARD', 'OTHER'],
      required: true,
    },
    currency: {
      type: String,
      enum: WALLET_CURRENCIES,
      required: true,
    },
    requiredAmount: safeIntegerField({ min: 1 }),
    payoutAmount: safeIntegerField({ min: 1 }),
    payoutCurrency: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      match: /^[A-Z]{3}$/,
    },
    active: {
      type: Boolean,
      default: true,
      required: true,
      index: true,
    },
    availability: {
      type: String,
      enum: ['AVAILABLE', 'UNAVAILABLE'],
      default: 'AVAILABLE',
      required: true,
      index: true,
    },
    eligibility: {
      ...objectField(),
      type: mongoose.Schema.Types.Mixed,
    },
    requiredDetails: {
      type: [{ type: String, trim: true, maxlength: 64 }],
      default: [],
      validate: {
        validator: (details) => details.length <= 20,
        message: 'requiredDetails cannot contain more than 20 fields.',
      },
    },
    metadata: {
      ...objectField(),
      type: mongoose.Schema.Types.Mixed,
    },
  },
  { timestamps: true },
);

payoutOptionSchema.index({ methodId: 1, active: 1, availability: 1 });
payoutOptionSchema.path('eligibility').validate(isPlainObject, 'eligibility must be a plain object.');
payoutOptionSchema.path('metadata').validate(isPlainObject, 'metadata must be a plain object.');

module.exports = mongoose.model('PayoutOption', payoutOptionSchema);
