const test = require('node:test');
const assert = require('node:assert/strict');
const { parseListFilters, AUDIT_CATEGORIES } = require('../services/audit.validation');
const { buildWhere } = require('../services/audit.service');

const USER_ID = '11111111-1111-4111-8111-111111111111';

function rejects400(fn, message) {
  assert.throws(fn, (err) => err.statusCode === 400 && err.message.includes(message));
}

test('no filters -> empty where (same as before)', () => {
  assert.deepEqual(buildWhere(parseListFilters({})), {});
});

test('existing filters keep working', () => {
  const filters = parseListFilters({
    actorUserId: USER_ID,
    action: 'BROKER_CREATED, BROKER_UPDATED',
    entity: 'Broker',
    entityId: 'abc',
    from: '2026-11-01T00:00:00+05:30',
    to: '2026-11-05T23:59:59+05:30',
  });
  const { AND } = buildWhere(filters);
  assert.deepEqual(AND[0], { actorUserId: USER_ID });
  assert.deepEqual(AND[1], { action: { in: ['BROKER_CREATED', 'BROKER_UPDATED'] } });
  assert.deepEqual(AND[2], { entity: 'Broker' });
  assert.deepEqual(AND[3], { entityId: 'abc' });
  assert.ok(AND.some((c) => c.createdAt && c.createdAt.gte && c.createdAt.lte));
});

test('q also searches actor name, firm and phone', () => {
  const { AND } = buildWhere(parseListFilters({ q: 'ramesh' }));
  const contains = { contains: 'ramesh', mode: 'insensitive' };
  assert.deepEqual(AND, [
    {
      OR: [
        { action: contains },
        { entityId: contains },
        { actor: { OR: [{ name: contains }, { firmName: contains }, { phone: contains }] } },
      ],
    },
  ]);
});

test('actorRole filters on the actor roles array', () => {
  const { AND } = buildWhere(parseListFilters({ actorRole: 'broker' }));
  assert.deepEqual(AND, [{ actor: { roles: { has: 'broker' } } }]);
  rejects400(() => parseListFilters({ actorRole: 'superuser' }), 'actorRole must be one of');
});

test('category maps to its entities and stacks with entity', () => {
  const { AND } = buildWhere(parseListFilters({ category: 'taxonomy', entity: 'Quality' }));
  assert.deepEqual(AND, [{ entity: 'Quality' }, { entity: { in: AUDIT_CATEGORIES.taxonomy } }]);
  rejects400(() => parseListFilters({ category: 'orders' }), 'category must be one of');
});

test('onBehalf=true narrows to *_BY_ADMIN actions, false is a no-op', () => {
  assert.deepEqual(buildWhere(parseListFilters({ onBehalf: 'true' })).AND, [
    { action: { endsWith: '_BY_ADMIN' } },
  ]);
  assert.deepEqual(buildWhere(parseListFilters({ onBehalf: 'false' })), {});
  rejects400(() => parseListFilters({ onBehalf: 'yes' }), 'onBehalf must be true or false');
});

test('targetUserId matches the user row and listing/broker snapshots', () => {
  const { AND } = buildWhere(parseListFilters({ targetUserId: USER_ID }));
  const or = AND[0].OR;
  assert.deepEqual(or[0], { entity: 'AppUser', entityId: USER_ID });
  assert.deepEqual(
    or.slice(1).map((c) => c.entity),
    ['Listing', 'Broker'],
  );
  assert.deepEqual(or[1].OR, [
    { after: { path: ['userId'], equals: USER_ID } },
    { before: { path: ['userId'], equals: USER_ID } },
  ]);
  rejects400(() => parseListFilters({ targetUserId: 'not-a-uuid' }), 'targetUserId must be a valid UUID');
});

test('all filters together are ANDed, nothing overwritten', () => {
  const { AND } = buildWhere(
    parseListFilters({ q: 'x', actorRole: 'admin', category: 'listings', onBehalf: 'true', targetUserId: USER_ID }),
  );
  assert.equal(AND.length, 5);
});

test('every audited entity belongs to exactly one category', () => {
  const all = Object.values(AUDIT_CATEGORIES).flat();
  assert.equal(new Set(all).size, all.length);
});
