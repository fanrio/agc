'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { validateSafeExternalUrl } = require('../srv/lib/urlUtils');
const { cartesianProduct } = require('../srv/services/hanaReplicationService');

test('Security Hardening Test Suite', async (t) => {

  await t.test('SSRF Prevention: validateSafeExternalUrl rejects insecure and private addresses', () => {
    // Non-HTTPS should be rejected
    assert.throws(() => {
      validateSafeExternalUrl('http://api.datasphere.cloud.sap/api/v1');
    }, /Forbidden protocol/);

    // Metadata endpoint should be rejected
    assert.throws(() => {
      validateSafeExternalUrl('https://169.254.169.254/latest/meta-data');
    }, /SSRF prevention/);

    // Private RFC 1918 subnets should be rejected
    assert.throws(() => {
      validateSafeExternalUrl('https://10.1.2.3/api');
    }, /SSRF prevention/);

    assert.throws(() => {
      validateSafeExternalUrl('https://192.168.1.100/api');
    }, /SSRF prevention/);

    assert.throws(() => {
      validateSafeExternalUrl('https://172.20.0.5/api');
    }, /SSRF prevention/);

    // Legitimate public HTTPS endpoints should succeed
    const valid = validateSafeExternalUrl('https://my-tenant.eu10.datasphere.cloud.sap');
    assert.strictEqual(valid, 'https://my-tenant.eu10.datasphere.cloud.sap');
  });

  await t.test('DoS Prevention: cartesianProduct aborts when combinations exceed safety limit', () => {
    // Normal size: 3 x 2 x 2 = 12 rows -> should succeed
    const normalInput = {
      Country: ['DE', 'FR', 'US'],
      Plant: ['1000', '2000'],
      Department: ['HR', 'IT']
    };
    const res = cartesianProduct(normalInput);
    assert.strictEqual(res.length, 12);

    // Excessive size: 5 fields with 10 values each = 100,000 rows > 50,000 limit -> must throw
    const tenValues = Array.from({ length: 10 }, (_, i) => `VAL_${i}`);
    const oversizedInput = {
      FieldA: tenValues,
      FieldB: tenValues,
      FieldC: tenValues,
      FieldD: tenValues,
      FieldE: tenValues
    };

    assert.throws(() => {
      cartesianProduct(oversizedInput);
    }, /Cartesian product size \(100000\) exceeds maximum safety limit/);
  });

});
