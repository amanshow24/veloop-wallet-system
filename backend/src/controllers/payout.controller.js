const payoutConfigService = require('../services/payoutConfigService');

async function getPayoutMethods(_req, res, next) {
  try {
    const methods = await payoutConfigService.getMethods();
    res.status(200).json({ success: true, methods });
  } catch (error) {
    next(error);
  }
}

async function getPayoutOptions(req, res, next) {
  try {
    const options = await payoutConfigService.getOptions(req.validatedQuery);
    res.status(200).json({ success: true, options });
  } catch (error) {
    next(error);
  }
}

module.exports = { getPayoutMethods, getPayoutOptions };
