/**
 * §6.1 — union-find over the adjudicated edge set. Deleting one edge and
 * re-running union-find reverses any merge (§4.3), so this stays a dumb,
 * replayable structure: no rank tricks that depend on insertion order beyond
 * determinism (smallest-root wins, so family ids are stable across runs).
 *
 * Pure module.
 */

export class UnionFind {
  private readonly parent = new Map<string, string>();

  private root(x: string): string {
    let r = this.parent.get(x);
    if (r === undefined) {
      this.parent.set(x, x);
      return x;
    }
    while (r !== this.parent.get(r)) {
      r = this.parent.get(r) as string;
    }
    // Path compression.
    let cur = x;
    while (cur !== r) {
      const next = this.parent.get(cur) as string;
      this.parent.set(cur, r);
      cur = next;
    }
    return r;
  }

  add(x: string): void {
    this.root(x);
  }

  union(a: string, b: string): void {
    const ra = this.root(a);
    const rb = this.root(b);
    if (ra === rb) return;
    // Deterministic: lexicographically smallest root wins.
    if (ra < rb) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
  }

  find(x: string): string {
    return this.root(x);
  }

  /** Groups keyed by root id, members sorted — stable across runs. */
  groups(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const key of [...this.parent.keys()].sort()) {
      const r = this.root(key);
      const group = out.get(r);
      if (group === undefined) out.set(r, [key]);
      else group.push(key);
    }
    return out;
  }
}
