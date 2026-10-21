const SETTING_KEY_REGEX = /^[a-z][a-z0-9_]{0,63}$/;

function validateSettingKey(key) {
  if (typeof key !== 'string' || !SETTING_KEY_REGEX.test(key)) {
    return 'key must be a lowercase snake_case identifier (letters, digits, underscore, max 64 chars)';
  }
  return null;
}

const SETTINGS_REGISTRY = {
  price_expiry_time: {
    // value shape: { "time": "02:00" } — 24hr HH:mm string; timezone is a fixed
    // code constant (Asia/Kolkata), not stored in this table
    validate: (value) =>
      typeof value === 'object' &&
      value !== null &&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(value.time),
  },
  // Independent of price_expiry_time (listings) — freight routes can expire at a
  // different time of day. Same value shape.
  freight_expiry_time: {
    validate: (value) =>
      typeof value === 'object' &&
      value !== null &&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(value.time),
  },
};

function validateSettingValue(key, value) {
  if (value === undefined) {
    return 'value is required';
  }

  const known = SETTINGS_REGISTRY[key];
  if (known && !known.validate(value)) {
    return `value is invalid for key "${key}"`;
  }

  return null;
}

module.exports = { SETTINGS_REGISTRY, validateSettingValue, validateSettingKey };
