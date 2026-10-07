"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NemaClient = void 0;
const errors_1 = require("./errors");
const database_1 = require("./database");
/**
 * A connection to one NemaDb gateway. Talks to it exactly the way the
 * Workbench and NemaDb's own shell do: plain HTTP/JSON, no custom wire
 * protocol — see the gateway's own docs for the full endpoint list
 * this wraps.
 */
class NemaClient {
    constructor(options) {
        this.baseUrl = options.url.replace(/\/+$/, "");
        this.apiKey = options.apiKey;
    }
    /**
     * The low-level call every other method goes through. Public
     * (rather than hidden entirely) as an escape hatch for a gateway
     * route this package hasn't wrapped yet, and because
     * `NemaDatabase`/`NemaCollection` need it too — see `internal.ts`
     * for why they depend on the `RequestExecutor` shape instead of this
     * concrete class.
     */
    async request(method, path, body) {
        const headers = { "Content-Type": "application/json" };
        if (this.apiKey)
            headers["Authorization"] = `Bearer ${this.apiKey}`;
        const init = { method, headers };
        if (body !== undefined && method !== "GET" && method !== "DELETE") {
            init.body = JSON.stringify(body);
        }
        let res;
        try {
            res = await fetch(`${this.baseUrl}${path}`, init);
        }
        catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            throw new errors_1.NemaError(`could not reach NemaDb gateway at ${this.baseUrl}: ${message}`, 0);
        }
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) {
            const message = (data && typeof data === "object" && "error" in data && String(data.error)) || `request failed: ${res.status}`;
            throw new errors_1.NemaError(message, res.status);
        }
        return data;
    }
    /** Whether the gateway is reachable at all. Never throws. */
    async health() {
        try {
            const res = await fetch(`${this.baseUrl}/health`);
            return res.ok;
        }
        catch {
            return false;
        }
    }
    /** Lists every database on this gateway. */
    async listDatabases() {
        return this.request("GET", "/databases");
    }
    /** Creates a new, empty database. */
    async createDatabase(name) {
        return this.request("POST", "/databases", { name });
    }
    /** Drops a database and every collection/document in it. Cannot be undone. */
    async dropDatabase(name) {
        await this.request("DELETE", `/databases/${encodeURIComponent(name)}`);
    }
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
    db(name) {
        return (0, database_1.withDynamicCollections)(new database_1.NemaDatabase(this, name));
    }
}
exports.NemaClient = NemaClient;
