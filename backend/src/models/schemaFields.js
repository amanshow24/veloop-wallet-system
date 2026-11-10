function safeIntegerField({ defaultValue, min = 0, required = true } = {}) {
  return {
    type: Number,
    required,
    min,
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
    validate: {
      validator: Number.isSafeInteger,
      message: '{PATH} must be a safe integer.',
    },
  };
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function objectField({ required = false } = {}) {
  return {
    type: Object,
    required,
    ...(required ? {} : { default: () => ({}) }),
    validate: {
      validator: isPlainObject,
      message: '{PATH} must be a plain object.',
    },
  };
}

module.exports = { isPlainObject, objectField, safeIntegerField };
