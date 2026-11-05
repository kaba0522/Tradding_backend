const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLastLoginFilter } = require('../services/user.service');

function rejects400(fn, message) {
  assert.throws(fn, (err) => err.statusCode === 400 && err.message.includes(message));
}

test('no last-login params -> no conditions', () => {
  assert.deepEqual(buildLastLoginFilter({}), []);
  assert.deepEqual(buildLastLoginFilter({ lastLoginFrom: '', inactiveDays: '' }), []);
});

test('lastLoginFrom / lastLoginTo', () => {
  const [from, to] = buildLastLoginFilter({
    lastLoginFrom: '2026-11-01T00:00:00+05:30',
    lastLoginTo: '2026-11-05T00:00:00+05:30',
  });
  assert.deepEqual(from, { refreshTokens: { some: { createdAt: { gte: new Date('2026-10-31T18:30:00Z') } } } });
  assert.deepEqual(to, { refreshTokens: { none: { createdAt: { gt: new Date('2026-11-04T18:30:00Z') } } } });
});

test('inactiveDays counts back from now', () => {
  const now = new Date('2026-11-05T00:00:00Z');
  const [cond] = buildLastLoginFilter({ inactiveDays: '15' }, now);
  assert.deepEqual(cond, { refreshTokens: { none: { createdAt: { gt: new Date('2026-10-21T00:00:00Z') } } } });
});

test('bad input -> 400', () => {
  rejects400(() => buildLastLoginFilter({ lastLoginFrom: 'kal' }), 'lastLoginFrom must be a valid date');
  rejects400(
    () => buildLastLoginFilter({ lastLoginFrom: '2026-11-05', lastLoginTo: '2026-11-01' }),
    'must not be after',
  );
  rejects400(() => buildLastLoginFilter({ inactiveDays: '0' }), 'inactiveDays must be a positive integer');
  rejects400(() => buildLastLoginFilter({ inactiveDays: '2.5' }), 'inactiveDays must be a positive integer');
});
