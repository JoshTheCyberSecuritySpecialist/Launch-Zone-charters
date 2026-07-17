const assert = require('node:assert/strict');
const test = require('node:test');
const adminDocumentAccessService = require('../services/adminDocumentAccessService');

test('mime and view mode from extension', () => {
  assert.equal(adminDocumentAccessService.mimeFromExtension('jpg'), 'image/jpeg');
  assert.equal(adminDocumentAccessService.mimeFromExtension('pdf'), 'application/pdf');
  assert.equal(adminDocumentAccessService.viewModeFromMime('image/png'), 'image');
  assert.equal(adminDocumentAccessService.viewModeFromMime('application/pdf'), 'pdf');
  assert.equal(adminDocumentAccessService.viewModeFromMime('application/octet-stream'), 'unsupported');
});

test('clean document kind and context', () => {
  assert.equal(adminDocumentAccessService.cleanDocumentKind('license'), 'license');
  assert.equal(adminDocumentAccessService.cleanDocumentKind('buoy-proof'), 'buoy_proof');
  assert.equal(adminDocumentAccessService.cleanContext('pre-trip'), 'pre_trip');
  assert.equal(adminDocumentAccessService.cleanDocumentKind('waiver'), null);
});

test('file name from object path', () => {
  assert.equal(
    adminDocumentAccessService.fileNameFromObjectPath('licenses/pre-trip/uuid/123-photo.jpg', 'license'),
    '123-photo.jpg'
  );
});

test('resolveAdminDocument rejects invalid record id without querying', async () => {
  await assert.rejects(
    () =>
      adminDocumentAccessService.resolveAdminDocument(null, {
        context: 'booking',
        recordId: 'not-a-uuid',
        document: 'license',
      }),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /Invalid record id/i);
      return true;
    }
  );
});

test('safeContentDispositionFilename strips quotes and newlines', () => {
  assert.equal(
    adminDocumentAccessService.safeContentDispositionFilename('evil"\nname.pdf', 'fallback.pdf'),
    'evilname.pdf'
  );
});
