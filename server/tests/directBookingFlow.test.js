'use strict';

const assert = require('assert');
const { pathToFileURL } = require('url');

async function run() {
  const {
    DIRECT_DEALS_PATH,
    parseDirectExperienceParam,
    directExperienceChooserPath,
    bookingUrlForDirectPackage,
  } = await import(pathToFileURL(require('path').join(__dirname, '../../src/lib/directBookingFlow.js')).href);

  assert.strictEqual(parseDirectExperienceParam('bio'), 'bio');
  assert.strictEqual(parseDirectExperienceParam('night_bio'), 'bio');
  assert.strictEqual(parseDirectExperienceParam('rocket_launch'), 'rocket');
  assert.strictEqual(parseDirectExperienceParam('sunset_cruise'), 'sunset');
  assert.strictEqual(parseDirectExperienceParam('nope'), null);

  assert.strictEqual(directExperienceChooserPath('bio'), `${DIRECT_DEALS_PATH}?experience=bio`);
  assert.strictEqual(directExperienceChooserPath('rocket_launch'), `${DIRECT_DEALS_PATH}?experience=rocket`);
  assert.strictEqual(directExperienceChooserPath(null), DIRECT_DEALS_PATH);

  assert.strictEqual(
    bookingUrlForDirectPackage('bio', 'bio_solo'),
    '/booking?bookingMode=charter&charterType=bio&package=bio_solo'
  );
  assert.strictEqual(
    bookingUrlForDirectPackage('rocket', 'rocket_duo'),
    '/booking?bookingMode=charter&charterType=rocket&package=rocket_duo'
  );
  assert.strictEqual(
    bookingUrlForDirectPackage('sunset', 'sunset_family'),
    '/booking?bookingMode=charter&charterType=sunset&package=sunset_family'
  );
  assert.strictEqual(bookingUrlForDirectPackage('bio', ''), null);
  assert.strictEqual(bookingUrlForDirectPackage('unknown', 'bio_solo'), null);

  console.log('directBookingFlow.test: all assertions passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
