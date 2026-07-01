import { describe, it, expect } from 'vitest';
import { isAncestorSelected, filterSelectedNodes } from '../RestrictionBuilder';

describe('RestrictionBuilder Selection Helpers', () => {
  describe('isAncestorSelected', () => {
    it('returns false for empty or invalid inputs', () => {
      expect(isAncestorSelected('0', [], null)).toBe(false);
      expect(isAncestorSelected('0', [], [])).toBe(false);
    });

    it('identifies selected ancestor with simple node IDs', () => {
      const flatNodes = [
        { ID: '1', parent_ID: null },
        { ID: '2', parent_ID: '1' },
        { ID: '3', parent_ID: '2' },
      ];

      // Direct parent is selected
      expect(isAncestorSelected('2', ['1'], flatNodes)).toBe(true);
      // Ancestor further up is selected
      expect(isAncestorSelected('3', ['1'], flatNodes)).toBe(true);
      // Siblings or children do not trigger it
      expect(isAncestorSelected('1', ['2'], flatNodes)).toBe(false);
      expect(isAncestorSelected('2', ['3'], flatNodes)).toBe(false);
      // Self is not considered ancestor
      expect(isAncestorSelected('2', ['2'], flatNodes)).toBe(false);
    });

    it('identifies selected ancestor with composite local IDs when original IDs are duplicate across hierarchies', () => {
      const flatNodes = [
        // DACH hierarchy
        { id: '0', parent_ID: null, hierarchy: 'DACH', localId: 'DACH-0', localParentId: null },
        { id: 'Germany', parent_ID: '0', hierarchy: 'DACH', localId: 'DACH-Germany', localParentId: 'DACH-0' },
        { id: 'Berlin', parent_ID: 'Germany', hierarchy: 'DACH', localId: 'DACH-Berlin', localParentId: 'DACH-Germany' },
        
        // APAC hierarchy (contains duplicate id '0')
        { id: '0', parent_ID: null, hierarchy: 'APAC', localId: 'APAC-0', localParentId: null },
        { id: 'Japan', parent_ID: '0', hierarchy: 'APAC', localId: 'APAC-Japan', localParentId: 'APAC-0' },
      ];

      // If we are looking at DACH hierarchy, we filter nodes to DACH
      const dachNodes = flatNodes.filter(n => n.hierarchy === 'DACH');
      const apacNodes = flatNodes.filter(n => n.hierarchy === 'APAC');

      // selection has DACH root (id: '0')
      expect(isAncestorSelected('Germany', ['0'], dachNodes)).toBe(true);
      expect(isAncestorSelected('Berlin', ['0'], dachNodes)).toBe(true);

      // selection has APAC root (id: '0'), checking APAC nodes
      expect(isAncestorSelected('Japan', ['0'], apacNodes)).toBe(true);

      // Clashing test: If DACH root '0' is selected but we check APAC 'Japan',
      // it should NOT treat it as selected ancestor if we pass apacNodes
      // because flatNodes.find finds correct node for original ID in apacNodes
      expect(isAncestorSelected('Japan', [], apacNodes)).toBe(false);
    });
  });

  describe('filterSelectedNodes', () => {
    it('removes child nodes if parent is also selected', () => {
      const flatNodes = [
        { ID: '1', parent_ID: null },
        { ID: '2', parent_ID: '1' },
        { ID: '3', parent_ID: '2' },
        { ID: '4', parent_ID: null },
      ];

      const selected = ['1', '2', '3', '4'];
      const filtered = filterSelectedNodes(selected, flatNodes);
      // '2' and '3' should be filtered out because their ancestor '1' is selected.
      // '1' and '4' remain.
      expect(filtered).toEqual(['1', '4']);
    });

    it('works with composite local IDs when original IDs overlap', () => {
      const dachNodes = [
        { id: '0', parent_ID: null, hierarchy: 'DACH', localId: 'DACH-0', localParentId: null },
        { id: 'Germany', parent_ID: '0', hierarchy: 'DACH', localId: 'DACH-Germany', localParentId: 'DACH-0' },
        { id: 'Berlin', parent_ID: 'Germany', hierarchy: 'DACH', localId: 'DACH-Berlin', localParentId: 'DACH-Germany' },
      ];

      const selected = ['0', 'Germany', 'Berlin'];
      const filtered = filterSelectedNodes(selected, dachNodes);
      expect(filtered).toEqual(['0']);
    });
  });
});
