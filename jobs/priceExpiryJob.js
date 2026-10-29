const os = require('os');
const cron = require('node-cron');
const { expireStalePrices } = require('../services/priceExpiry.service');

// Identifies WHICH process expired the rows (several servers can share one DB).
// Only the DB host is logged — never the credentials in the URL.
function describeProcess() {
  let dbHost = 'unknown';
  try {
    dbHost = new URL(process.env.DATABASE_URL).host;
  } catch (err) {
    // DATABASE_URL missing/unparseable — keep 'unknown'.
  }
  return `host=${os.hostname()} pid=${process.pid} env=${process.env.NODE_ENV || 'unset'} db=${dbHost}`;
}

async function runExpiryCheck() {
  try {
    const { listingsExpired, freightRoutesExpired } = await expireStalePrices();
    if (listingsExpired > 0 || freightRoutesExpired > 0) {
      console.log(
        `[priceExpiryJob] expired ${listingsExpired} listing(s), ${freightRoutesExpired} freight route(s) by ${describeProcess()}`
      );
    }
  } catch (err) {
    // Never let a failed run crash the server — just log and try again next tick.
    console.error('[priceExpiryJob] run failed:', err);
  }
}

function start() {
  // Kill switch for testing: set PRICE_EXPIRY_JOB_ENABLED=false (e.g. on Render)
  // to stop prices from expiring. Remove the var or set it to true to resume.
  if (String(process.env.PRICE_EXPIRY_JOB_ENABLED).toLowerCase() === 'false') {
    console.log('[priceExpiryJob] disabled via PRICE_EXPIRY_JOB_ENABLED=false');
    return;
  }
  // Catch up immediately on boot (covers any downtime), then every hour on
  // the hour. The check is time-agnostic — priceValidUntil is pre-computed
  // per row, so this doesn't need to know the admin's configured expiry time.
  console.log(`[priceExpiryJob] enabled, running on ${describeProcess()}`);
  runExpiryCheck();
  cron.schedule('0 * * * *', runExpiryCheck);
}

module.exports = { start, runExpiryCheck };
