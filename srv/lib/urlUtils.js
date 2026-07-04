'use strict';

/**
 * Shared URL utility helpers.
 * Consolidates the two previously duplicated isMockUrl implementations
 * from authorization-service.js and bdcClient.js (fixes audit finding F-20).
 */

const MOCK_URL_PATTERNS = ['mock', 'sandbox', 'test', 'localhost', 'example.com', '127.0.0.1'];

/**
 * Returns true when the URL is clearly a local / mock / sandbox endpoint
 * that should not make real outbound HTTP calls.
 * @param {string} url
 * @returns {boolean}
 */
function isMockUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return MOCK_URL_PATTERNS.some(p => lower.includes(p));
}

module.exports = { isMockUrl };
