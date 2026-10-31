const { AppError } = require('../lib/errors');
const { validateUuid } = require('../lib/validators');

const MAX_FILTER_LENGTH = 100;
const MAX_ACTIONS = 20;

function optionalString(value, fieldName) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new AppError(`${fieldName} must be a string`, 400);
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_FILTER_LENGTH) {
    throw new AppError(`${fieldName} must be at most ${MAX_FILTER_LENGTH} characters`, 400);
  }
  return trimmed || undefined;
}

function optionalDate(value, fieldName) {
  const raw = optionalString(value, fieldName);
  if (raw === undefined) return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(`${fieldName} must be a valid date`, 400);
  }
  return date;
}

// Turns the raw query string into a clean filter object. `action` may be a
// comma-separated list (?action=BROKER_CREATED,BROKER_UPDATED).
function parseListFilters(query = {}) {
  const filters = {};

  const actorUserId = optionalString(query.actorUserId, 'actorUserId');
  if (actorUserId) filters.actorUserId = validateUuid(actorUserId, 'actorUserId');

  const actionRaw = optionalString(query.action, 'action');
  if (actionRaw) {
    const actions = actionRaw.split(',').map((a) => a.trim()).filter(Boolean);
    if (actions.length > MAX_ACTIONS) {
      throw new AppError(`action accepts at most ${MAX_ACTIONS} values`, 400);
    }
    filters.actions = actions;
  }

  filters.entity = optionalString(query.entity, 'entity');
  filters.entityId = optionalString(query.entityId, 'entityId');
  filters.q = optionalString(query.q, 'q');
  filters.from = optionalDate(query.from, 'from');
  filters.to = optionalDate(query.to, 'to');

  if (filters.from && filters.to && filters.from > filters.to) {
    throw new AppError('from must not be after to', 400);
  }

  return filters;
}

module.exports = { parseListFilters };
