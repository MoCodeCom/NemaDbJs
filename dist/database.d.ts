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
export declare class NemaDatabase {
    private readonly client;
    readonly name: string;
    constructor(client: RequestExecutor, name: string);
    /** Lists every collection in this database, with document counts. */
    listCollections(): Promise<CollectionInfo[]>;
    /**
     * Creates an empty collection. Not required before using
     * `collection(name)` — inserting into a collection that doesn't
     * exist yet creates it implicitly, the same as NemaDb itself does —
     * this is for when you want an empty collection to show up (e.g. in
     * the Workbench) before the first document lands in it.
     */
    createCollection(name: string): Promise<{
        name: string;
    }>;
    /** Drops a collection and every document in it. Cannot be undone. */
    dropCollection(name: string): Promise<void>;
    /** A handle to one collection in this database. */
    collection(name: string): NemaCollection;
}
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
declare function withDynamicCollections<T extends NemaDatabase>(db: T): T & Record<string, NemaCollection>;
export { withDynamicCollections };
