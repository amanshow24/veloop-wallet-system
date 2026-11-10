const mongoose = require('mongoose');
const { isPlainObject, objectField } = require('./schemaFields');

const payoutMethodSchema = new mongoose.Schema(
  {
    methodId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: /^[a-z][a-z0-9_]{1,39}$/,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    type: {
      type: String,
      enum: ['UPI', 'PAYPAL', 'AMAZON_GIFT_CARD', 'GOOGLE_PLAY_GIFT_CARD'],
      required: true,
    },
    active: {
      type: Boolean,
      default: false,
      required: true,
      index: true,
    },
    availability: {
      type: String,
      enum: ['AVAILABLE', 'UNAVAILABLE'],
      default: 'UNAVAILABLE',
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

payoutMethodSchema.path('eligibility').validate(isPlainObject, 'eligibility must be a plain object.');
payoutMethodSchema.path('metadata').validate(isPlainObject, 'metadata must be a plain object.');

module.exports = mongoose.model('PayoutMethod', payoutMethodSchema);
