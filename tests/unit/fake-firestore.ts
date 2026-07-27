/**
 * A tiny in-memory stand-in for the slice of Firestore the inheritance-tax store uses:
 * nested collections, doc set/get, orderBy/limit/where queries, and runTransaction.
 *
 * It exists so the audit chain and the review rules can be tested without emulators. It is NOT
 * a Firestore emulator — `runTransaction` here is serial, so it proves the transaction is used,
 * not that Firestore's contention retry works.
 */

interface Doc {
  id: string;
  data: Record<string, unknown>;
}

class FakeQuery {
  constructor(
    private readonly docs: () => Doc[],
    private readonly ops: Array<(rows: Doc[]) => Doc[]> = [],
  ) {}

  private chain(op: (rows: Doc[]) => Doc[]): FakeQuery {
    return new FakeQuery(this.docs, [...this.ops, op]);
  }

  orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): FakeQuery {
    return this.chain((rows) =>
      [...rows].sort((a, b) => {
        const av = a.data[field] as string | number | undefined;
        const bv = b.data[field] as string | number | undefined;
        const cmp = av === bv ? 0 : (av ?? 0) < (bv ?? 0) ? -1 : 1;
        return dir === 'desc' ? -cmp : cmp;
      }),
    );
  }

  limit(n: number): FakeQuery {
    return this.chain((rows) => rows.slice(0, n));
  }

  where(field: string, _op: string, value: unknown): FakeQuery {
    return this.chain((rows) => rows.filter((r) => r.data[field] === value));
  }

  async get(): Promise<{ docs: Array<{ id: string; data: () => Record<string, unknown> }> }> {
    let rows = this.docs();
    for (const op of this.ops) rows = op(rows);
    return { docs: rows.map((r) => ({ id: r.id, data: () => r.data })) };
  }
}

class FakeCollection extends FakeQuery {
  constructor(private readonly store: Map<string, Record<string, unknown>>, private readonly path: string) {
    super(() =>
      [...store.entries()]
        .filter(([k]) => k.startsWith(`${path}/`) && k.slice(path.length + 1).split('/').length === 1)
        .map(([k, data]) => ({ id: k.slice(path.length + 1), data })),
    );
  }

  doc(id: string): FakeDoc {
    return new FakeDoc(this.store, `${this.path}/${id}`);
  }
}

class FakeDoc {
  constructor(private readonly store: Map<string, Record<string, unknown>>, private readonly path: string) {}

  collection(name: string): FakeCollection {
    return new FakeCollection(this.store, `${this.path}/${name}`);
  }

  async set(data: Record<string, unknown>): Promise<void> {
    this.store.set(this.path, data);
  }

  async get(): Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }> {
    const data = this.store.get(this.path);
    return { exists: data !== undefined, data: () => data };
  }
}

export function createFakeFirestore() {
  const store = new Map<string, Record<string, unknown>>();
  const db = {
    collection: (name: string) => new FakeCollection(store, name),
    runTransaction: async <T>(fn: (t: unknown) => Promise<T>): Promise<T> =>
      fn({
        get: (q: { get: () => Promise<unknown> }) => q.get(),
        set: (ref: FakeDoc, data: Record<string, unknown>) => {
          void ref.set(data);
        },
      }),
    /** Test-only: reach into raw storage to tamper with a stored document. */
    __raw: store,
  };
  return db as unknown as FirebaseFirestore.Firestore & { __raw: Map<string, Record<string, unknown>> };
}
