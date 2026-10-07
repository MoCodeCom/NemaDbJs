"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NemaDatabase = void 0;
exports.withDynamicCollections = withDynamicCollections;
const collection_1 = require("./collection");
/**
 * A handle to one database on the gateway. Like `NemaCollection`,
 * holds no connection state of its own — safe to construct freely via
 * `client.db(name)` rather than needing to be cached.
 */
class NemaDatabase {
    constructor(client, name) {
        this.client = client;
        this.name = name;
    }
    /** Lists every collection in this database, with document counts. */
    async listCollections() {
        return this.client.request("GET", `/databases/${encodeURIComponent(this.name)}/collections`);
    }
    /**
     * Creates an empty collection. Not required before using
     * `collection(name)` — inserting into a collection that doesn't
     * exist yet creates it implicitly, the same as NemaDb itself does —
     * this is for when you want an empty collection to show up (e.g. in
     * the Workbench) before the first document lands in it.
     */
    async createCollection(name) {
        return this.client.request("POST", `/databases/${encodeURIComponent(this.name)}/collections`, { name });
    }
    /** Drops a collection and every document in it. Cannot be undone. */
    async dropCollection(name) {
        await this.client.request("DELETE", `/databases/${encodeURIComponent(this.name)}/collections/${encodeURIComponent(name)}`);
    }
    /** A handle to one collection in this database. */
    collection(name) {
        return new collection_1.NemaCollection(this.client, this.name, name);
    }
}
exports.NemaDatabase = NemaDatabase;
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
function withDynamicCollections(db) {
    return new Proxy(db, {
        get(target, prop, receiver) {
            if (typeof prop === "symbol" || prop in target || NEVER_A_COLLECTION_NAME.has(prop)) {
                return Reflect.get(target, prop, receiver);
            }
            return target.collection(prop);
        },
    });
}
