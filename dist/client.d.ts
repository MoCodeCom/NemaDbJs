import { RequestExecutor } from "./internal";
import { NemaDatabase } from "./database";
import { NemaCollection } from "./collection";
export interface NemaClientOptions {
    /** The nemadb-gateway's base URL, e.g. `"http://127.0.0.1:8070"`. */
    url: string;
    /**
     * Sent as `Authorization: Bearer <apiKey>` on every request except
     * `/health`. Only needed if the gateway was started with
     * `--api-key`/`NEMADB_API_KEY` — harmless to omit otherwise.
     */
    apiKey?: string;
}
/**
 * A connection to one NemaDb gateway. Talks to it exactly the way the
 * Workbench and NemaDb's own shell do: plain HTTP/JSON, no custom wire
 * protocol — see the gateway's own docs for the full endpoint list
 * this wraps.
 */
export declare class NemaClient implements RequestExecutor {
    private readonly baseUrl;
    private readonly apiKey?;
    constructor(options: NemaClientOptions);
    /**
     * The low-level call every other method goes through. Public
     * (rather than hidden entirely) as an escape hatch for a gateway
     * route this package hasn't wrapped yet, and because
     * `NemaDatabase`/`NemaCollection` need it too — see `internal.ts`
     * for why they depend on the `RequestExecutor` shape instead of this
     * concrete class.
     */
    request<T>(method: string, path: string, body?: unknown): Promise<T>;
    /** Whether the gateway is reachable at all. Never throws. */
    health(): Promise<boolean>;
    /** Lists every database on this gateway. */
    listDatabases(): Promise<string[]>;
    /** Creates a new, empty database. */
    createDatabase(name: string): Promise<{
        name: string;
    }>;
    /** Drops a database and every collection/document in it. Cannot be undone. */
    dropDatabase(name: string): Promise<void>;
    /**
     * A handle to a database. Does not itself check that the database
     * exists — that only happens once you call something on it (or
     * `createCollection`/an insert) that actually reaches the gateway.
     *
     * The returned handle also supports `db.posts` as shorthand for
     * `db.collection("posts")` — any collection name works, not just
     * ones with types declared for them, hence the `Record` in the
     * return type. See `withDynamicCollections` for why `then`/`catch`/
     * `finally`/`toJSON` are the one thing this never treats as a
     * collection name.
     */
    db(name: string): NemaDatabase & Record<string, NemaCollection>;
}
