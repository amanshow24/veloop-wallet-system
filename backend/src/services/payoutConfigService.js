const PayoutMethod = require('../models/PayoutMethod');
const PayoutOption = require('../models/PayoutOption');
const httpError = require('../utils/httpError');

function validateMethodId(methodId) {
  if (
    typeof methodId !== 'string' ||
    !/^[a-z][a-z0-9_]{1,39}$/i.test(methodId.trim())
  ) {
    throw httpError(400, 'A valid payout method ID is required.');
  }
  return methodId.trim().toLowerCase();
}

async function getMethods() {
  const methods = await PayoutMethod.find({})
    .sort({ methodId: 1 })
    .lean();

  if (methods.length === 0) {
    return [];
  }

  const options = await PayoutOption.find({
    methodId: { $in: methods.map((method) => method.methodId) },
  })
    .sort({ methodId: 1, requiredAmount: 1, optionId: 1 })
    .lean();

  const optionsByMethod = new Map(methods.map((method) => [method.methodId, []]));
  for (const option of options) {
    optionsByMethod.get(option.methodId)?.push(option);
  }

  return methods.map((method) => ({
    ...method,
    options: optionsByMethod.get(method.methodId),
  }));
}

async function getOptions({ methodId } = {}) {
  const filter = {};

  if (methodId !== undefined) {
    const normalizedMethodId = validateMethodId(methodId);
    const method = await PayoutMethod.findOne({ methodId: normalizedMethodId }).lean();
    if (!method) {
      throw httpError(404, 'Payout method not found.');
    }
    filter.methodId = normalizedMethodId;
  }

  return PayoutOption.find(filter)
    .sort({ methodId: 1, requiredAmount: 1, optionId: 1 })
    .lean();
}

async function validatePayoutSelection({ methodId, optionId } = {}) {
  const normalizedMethodId = validateMethodId(methodId);
  if (
    typeof optionId !== 'string' ||
    !/^[a-z][a-z0-9_]{1,127}$/i.test(optionId.trim())
  ) {
    throw httpError(400, 'A valid payout option ID is required.');
  }

  const method = await PayoutMethod.findOne({ methodId: normalizedMethodId }).lean();
  if (!method || !method.active || method.availability !== 'AVAILABLE') {
    throw httpError(409, 'This payout method is currently unavailable.');
  }

  const option = await PayoutOption.findOne({
    methodId: normalizedMethodId,
    optionId: optionId.trim().toLowerCase(),
  }).lean();
  if (!option || !option.active || option.availability !== 'AVAILABLE') {
    throw httpError(409, 'Selected payout option is unavailable.');
  }

  return { method, option };
}

module.exports = { getMethods, getOptions, validatePayoutSelection };
