import { RequestExecutor } from "./internal";
import { NemaCollection } from "./collection";

export interface CollectionInfo {
  name: string;
  count: number;
}

/**
 * A handle to one database on the gateway. Like `NemaCollection`,
 * holds no connection state of its own — safe to construct freely via
 * `client.db(name)` rather than needing to be cached.
 */
export class NemaDatabase {
  constructor(private readonly client: RequestExecutor, public readonly name: string) {}

  /** Lists every collection in this database, with document counts. */
  async listCollections(): Promise<CollectionInfo[]> {
    return this.client.request("GET", `/databases/${encodeURIComponent(this.name)}/collections`);
  }

  /**
   * Creates an empty collection. Not required before using
   * `collection(name)` — inserting into a collection that doesn't
   * exist yet creates it implicitly, the same as NemaDb itself does —
   * this is for when you want an empty collection to show up (e.g. in
   * the Workbench) before the first document lands in it.
   */
  async createCollection(name: string): Promise<{ name: string }> {
    return this.client.request("POST", `/databases/${encodeURIComponent(this.name)}/collections`, { name });
  }

  /** Drops a collection and every document in it. Cannot be undone. */
  async dropCollection(name: string): Promise<void> {
    await this.client.request(
      "DELETE",
      `/databases/${encodeURIComponent(this.name)}/collections/${encodeURIComponent(name)}`
    );
  }

  /** A handle to one collection in this database. */
  collection(name: string): NemaCollection {
    return new NemaCollection(this.client, this.name, name);
  }
}

/**
 * Property names that must *never* resolve to a collection, even
 * though `db.<anything>` normally does once `withDynamicCollections`
 * wraps it. `then`/`catch`/`finally` are the dangerous ones: if
 * `db.then` returned a `NemaCollection` object (a truthy, non-function
 * value) instead of `undefined`, `await db` or `Promise.resolve(db)`
 * would see a "thenable" and try to call `.then` on it as a function —
 * not what anyone wants from awaiting a database handle, and a real,
 * easy-to-hit bug class for any Proxy-based dynamic-property trick
 * like this one.
 */
const NEVER_A_COLLECTION_NAME = new Set(["then", "catch", "finally", "toJSON"]);

/**
 * Wraps `db` so `db.posts` works as shorthand for
 * `db.collection("posts")` — mirroring `mongosh`'s own dynamic
 * collection access, on top of (not instead of) the explicit
 * `.collection(name)` method, which still works and is what
 * `db.posts` is doing underneath. Real members of `NemaDatabase`
 * itself (`.name`, `.collection`, `.listCollections`, ...) always
 * win — only a property name `NemaDatabase` doesn't already have falls
 * through to being treated as a collection name.
 */
function withDynamicCollections<T extends NemaDatabase>(db: T): T & Record<string, NemaCollection> {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (typeof prop === "symbol" || prop in target || NEVER_A_COLLECTION_NAME.has(prop)) {
        return Reflect.get(target, prop, receiver);
      }
      return target.collection(prop);
    },
  }) as T & Record<string, NemaCollection>;
}

export { withDynamicCollections };
