import { describe, expect, it } from 'vitest';
import { UnionFind } from '../src/union-find.js';

describe('UnionFind (§6.1 — replayable)', () => {
  it('groups connected components', () => {
    const uf = new UnionFind();
    uf.union('a', 'b');
    uf.union('b', 'c');
    uf.add('d');
    expect(uf.find('a')).toBe(uf.find('c'));
    expect(uf.find('d')).not.toBe(uf.find('a'));
    const groups = uf.groups();
    expect(groups.get('a')).toEqual(['a', 'b', 'c']);
    expect(groups.get('d')).toEqual(['d']);
  });

  it('is order-independent — smallest root wins deterministically', () => {
    const uf1 = new UnionFind();
    uf1.union('z', 'm');
    uf1.union('m', 'a');
    const uf2 = new UnionFind();
    uf2.union('a', 'z');
    uf2.union('z', 'm');
    expect(uf1.find('z')).toBe('a');
    expect(uf2.find('z')).toBe('a');
    expect([...uf1.groups().keys()]).toEqual([...uf2.groups().keys()]);
  });

  it('removing an edge and replaying reverses a merge (one-edge reversal)', () => {
    const edges: Array<[string, string]> = [
      ['a', 'b'],
      ['b', 'c'],
    ];
    const withAll = new UnionFind();
    for (const [x, y] of edges) withAll.union(x, y);
    expect(withAll.find('c')).toBe('a');

    // Adam disputes b-c: delete it, re-run union-find — no upstream recompute.
    const without = new UnionFind();
    without.add('c');
    for (const [x, y] of edges.filter(([, y2]) => y2 !== 'c')) without.union(x, y);
    expect(without.find('c')).toBe('c');
    expect(without.find('b')).toBe('a');
  });
});
