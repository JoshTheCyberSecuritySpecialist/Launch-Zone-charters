const assert = require('assert');

function safeAdminRedirectPath(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/admin')) return '/admin';
  if (raw.startsWith('//') || raw.includes('://')) return '/admin';
  return raw;
}

function run() {
  assert.strictEqual(safeAdminRedirectPath('/admin'), '/admin');
  assert.strictEqual(safeAdminRedirectPath('/admin/bookings'), '/admin/bookings');
  assert.strictEqual(safeAdminRedirectPath('https://evil.test/admin'), '/admin');
  assert.strictEqual(safeAdminRedirectPath('//evil.test/admin'), '/admin');
  assert.strictEqual(safeAdminRedirectPath('/booking'), '/admin');
  console.log('adminLoginRedirect.test: all assertions passed');
}

run();
