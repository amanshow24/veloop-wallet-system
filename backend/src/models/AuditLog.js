const mongoose = require('mongoose');
const { isPlainObject, objectField } = require('./schemaFields');

const auditLogSchema = new mongoose.Schema(
  {
    actorType: {
      type: String,
      enum: ['USER', 'SYSTEM'],
      default: 'USER',
      required: true,
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      required() {
        return this.actorType === 'USER';
      },
      index: true,
    },
    action: {
      type: String,
      enum: [
        'WITHDRAWAL_CREATED',
        'WITHDRAWAL_PROCESSING',
        'WITHDRAWAL_APPROVED',
        'WITHDRAWAL_REJECTED',
        'WITHDRAWAL_CANCELLED',
        'WALLET_CREDIT',
        'WALLET_DEBIT',
        'BALANCE_CORRECTION',
        'PAYOUT_CONFIGURATION_CHANGED',
      ],
      required: true,
    },
    targetUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    targetType: {
      type: String,
      enum: [
        'USER',
        'WALLET',
        'WALLET_TRANSACTION',
        'WITHDRAWAL',
        'PAYOUT_METHOD',
        'PAYOUT_OPTION',
      ],
      required: true,
      index: true,
    },
    referenceId: {
      type: String,
      default: null,
      trim: true,
      maxlength: 128,
      index: true,
    },
    metadata: {
      ...objectField(),
      type: mongoose.Schema.Types.Mixed,
    },
    ipAddress: {
      type: String,
      trim: true,
      maxlength: 64,
      default: null,
    },
    sessionId: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ targetUserId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.path('metadata').validate(isPlainObject, 'metadata must be a plain object.');

auditLogSchema.pre('save', function rejectExistingAuditLogSave() {
  if (!this.isNew) {
    throw new Error('Audit log records are append-only.');
  }
});

auditLogSchema.pre('deleteOne', { document: true, query: false }, function rejectDocumentDelete() {
  throw new Error('Audit log records are append-only.');
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
  auditLogSchema.pre(operation, function rejectAuditLogMutation() {
    throw new Error('Audit log records are append-only.');
  });
}

module.exports = mongoose.model('AuditLog', auditLogSchema);
