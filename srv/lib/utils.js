'use strict';

/**
 * Wraps JSON parsing to prevent runtime syntax crashes
 * @param {string} val - String representation of JSON
 * @param {any} [fallback=[]] - Fallback value if parsing fails
 * @returns {any} parsed JSON or fallback
 */
function safeJsonParse(val, fallback = []) {
  if (!val) return fallback;
  try {
    return JSON.parse(val);
  } catch (e) {
    console.error(`JSON Parse failed for value: ${val}`, e);
    return fallback;
  }
}

module.exports = {
  safeJsonParse
};
