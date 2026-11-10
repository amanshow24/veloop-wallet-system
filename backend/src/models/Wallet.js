const mongoose = require('mongoose');
const { safeIntegerField } = require('./schemaFields');

const walletSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    ves: safeIntegerField({ defaultValue: 0 }),
    sves: safeIntegerField({ defaultValue: 0 }),
    gems: safeIntegerField({ defaultValue: 0 }),
    tokens: safeIntegerField({ defaultValue: 0 }),
    spins: safeIntegerField({ defaultValue: 0 }),
  },
  { timestamps: true },
);

module.exports = mongoose.model('Wallet', walletSchema);
