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

function isPrivateIpOrHost(hostname) {
  if (!hostname) return true;
  const clean = hostname.toLowerCase().trim();
  if (['localhost', '127.0.0.1', '::1', '0.0.0.0', '169.254.169.254'].includes(clean)) return true;
  if (/^10\./.test(clean)) return true;
  if (/^192\.168\./.test(clean)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(clean)) return true;
  return false;
}

/**
 * Validates that an external URL uses HTTPS and does not point to internal/private IP addresses or metadata services.
 * Allows mock URLs only in automated test environments.
 */
function validateSafeExternalUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    throw new Error('Missing or invalid URL');
  }
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch (err) {
    throw new Error(`Invalid URL format: ${urlString}`);
  }
  if (isPrivateIpOrHost(parsed.hostname)) {
    throw new Error(`Access to private or link-local host '${parsed.hostname}' is prohibited (SSRF prevention).`);
  }
  const isTest = process.env.NODE_ENV === 'test' ||
                 process.execArgv.includes('--test') ||
                 (process.argv[1] && process.argv[1].includes('test'));
  if (isTest && isMockUrl(urlString)) {
    return urlString;
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`Forbidden protocol '${parsed.protocol}'. External integration endpoints must use HTTPS.`);
  }
  return urlString;
}

module.exports = { isMockUrl, validateSafeExternalUrl };
