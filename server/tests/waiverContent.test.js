const assert = require('node:assert/strict');
const test = require('node:test');
const waiverContent = require('../content/waiverContent');

test('buildWaiverContent includes version and full legal sections', () => {
  const rental = waiverContent.buildWaiverContent('rental');
  assert.match(rental, /Version 1\.0/);
  assert.match(rental, /Assumption of Risk/);
  assert.match(rental, /Security deposit/);

  const charter = waiverContent.buildWaiverContent('charter');
  assert.match(charter, /captain safety instructions/i);
  assert.doesNotMatch(charter, /Security deposit/);
});

test('waiverInsertFields returns content and version metadata', () => {
  const fields = waiverContent.waiverInsertFields('rental');
  assert.equal(fields.waiver_version, '1.0');
  assert.ok(fields.waiver_content.length > 500);
  assert.ok(fields.waiver_version_effective_at);
});
