export const ENV_LABEL = {
  P: 'Production',
  Q: 'Quality Assurance',
  D: 'Development'
};

export const ENV_COLOR = {
  P: 'error',
  Q: 'warning',
  D: 'info'
};

// Helper to format ISO datetime strings
export function formatDateTime(isoString) {
  if (!isoString) return '—';
  const date = new Date(isoString);
  return date.toLocaleString(undefined, { 
    dateStyle: 'short', 
    timeStyle: 'short' 
  });
}

// Helper to determine if a specific restriction is critical
export function isCriticalRestriction(r, orgNodes = []) {
  const type = r.filterType;
  const val = r.value || '';
  if (type === 'SINGLE_VALUE') {
    return val.toUpperCase() === 'ALL';
  }
  if (type === 'MULTI_VALUE') {
    try {
      const arr = JSON.parse(val);
      if (Array.isArray(arr) && arr.some(v => String(v).toUpperCase() === 'ALL')) {
        return true;
      }
    } catch (e) {
      if (val.toUpperCase() === 'ALL') return true;
    }
  }
  if (type === 'PATTERN') {
    return val.includes('*');
  }
  if (type === 'HIERARCHY') {
    const node = orgNodes.find(n => n.ID === val);
    if (node) {
      return !node.parent_ID && (!node.parent || !node.parent.ID);
    }
  }
  return false;
}
