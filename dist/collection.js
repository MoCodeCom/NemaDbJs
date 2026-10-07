"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NemaCollection = void 0;
const errors_1 = require("./errors");
/**
 * A handle to one collection within one database. Cheap to create —
 * it holds no connection state of its own, just names — so there's no
 * need to cache what `db.collection(name)` returns.
 */
class NemaCollection {
    constructor(client, databaseName, name) {
        this.client = client;
        this.databaseName = databaseName;
        this.name = name;
    }
    path(suffix = "") {
        return `/databases/${encodeURIComponent(this.databaseName)}/collections/${encodeURIComponent(this.name)}${suffix}`;
    }
    /** Inserts `doc`, assigning it an `_id` if it doesn't have one. */
    async insert(doc) {
        return this.client.request("POST", this.path(), doc);
    }
    /** Fetches a document by id, or `null` if no such document exists. */
    async get(id) {
        return this.orNullOn404(this.client.request("GET", this.path(`/${encodeURIComponent(id)}`)));
    }
    /**
     * Replaces the document at `id` wholesale, keeping its original
     * `_id` regardless of what `doc` carries. Not an upsert — returns
     * `null` (and changes nothing) if `id` doesn't exist. On success,
     * returns the *previous* value.
     */
    async replace(id, doc) {
        return this.orNullOn404(this.client.request("PUT", this.path(`/${encodeURIComponent(id)}`), doc));
    }
    /** Deletes the document at `id`, returning it, or `null` if it didn't exist. */
    async delete(id) {
        return this.orNullOn404(this.client.request("DELETE", this.path(`/${encodeURIComponent(id)}`)));
    }
    /** Finds every document matching `query` (`{}` matches everything). */
    async find(query = {}) {
        return this.client.request("POST", this.path("/find"), query);
    }
    /** Runs an aggregation pipeline (`$match`/`$project`/`$group`) over this collection. */
    async aggregate(pipeline) {
        return this.client.request("POST", this.path("/aggregate"), pipeline);
    }
    /**
     * Counts documents matching `query` (`{}` counts the whole
     * collection) — server-side: the matched documents are counted on
     * the gateway and never sent over the wire, unlike
     * `(await find(query)).length`.
     */
    async count(query = {}) {
        const { count } = await this.client.request("POST", this.path("/count"), query);
        return count;
    }
    /**
     * The distinct values `field` takes on across documents matching
     * `query` (`{}` — the default — considers the whole collection).
     * Server-side, like {@link count}. `field` supports dotted paths
     * (`"address.city"`), same as everywhere else in NemaDb's queries.
     */
    async distinct(field, query = {}) {
        return this.client.request("POST", this.path("/distinct"), { field, filter: query });
    }
    /**
     * Builds a secondary index on `field` (dotted paths like
     * `"address.city"` work). Pass `{ unique: true }` to also enforce
     * uniqueness — see `CreateIndexOptions`.
     */
    async createIndex(field, options = {}) {
        await this.client.request("POST", this.path("/indexes"), { field, unique: !!options.unique });
    }
    // ---- MongoDB-familiar aliases ----
    //
    // Exactly the same methods above, under the names `mongosh`/the
    // official drivers use — for anyone coming from real MongoDB who'd
    // rather write `insertOne`/`findOne` than NemaDb's own shorter
    // `insert`/`find`. Both spellings work everywhere; neither is more
    // "correct" than the other. Two real MongoDB methods are
    // deliberately *not* aliased: `insertMany` (NemaDb's gateway has no
    // bulk-insert endpoint) and `updateOne` (which in real MongoDB means
    // a partial `$set`-style update — NemaDb only has whole-document
    // replace, which is what MongoDB itself calls `replaceOne`, so
    // that's the name given here instead of a misleading `updateOne`).
    /** Alias for {@link insert}. */
    async insertOne(doc) {
        return this.insert(doc);
    }
    /**
     * Like {@link find}, but returns just the first match (or `null`)
     * instead of an array. Implemented client-side — NemaDb's gateway
     * has no dedicated "first match only" endpoint, so this still fetches
     * every match under the hood and isn't a real optimization for a
     * large result set.
     */
    async findOne(query = {}) {
        const results = await this.find(query);
        return results.length > 0 ? results[0] : null;
    }
    /**
     * Alias for {@link replace} — a whole-document replace, the same
     * thing MongoDB itself calls `replaceOne`. Takes an id directly, not
     * a filter (unlike real MongoDB's `replaceOne`) — NemaDb's gateway
     * only supports replace-by-id.
     */
    async replaceOne(id, doc) {
        return this.replace(id, doc);
    }
    /**
     * Alias for {@link delete}. Takes an id directly, not a filter
     * (unlike real MongoDB's `deleteOne`) — NemaDb's gateway only
     * supports delete-by-id.
     */
    async deleteOne(id) {
        return this.delete(id);
    }
    /**
     * A partial update, at last: applies `update`'s operators
     * (`$set`/`$inc`/`$push`/... — see {@link NemaUpdate}) to the first
     * document matching `query`, atomically (the gateway matches and
     * writes under one lock). Unlike `findOneAndDelete`/
     * `findOneAndReplace`, a no-match is not an error — it comes back as
     * `{ matched: false, modified: false, upsertedId: null }`, the same
     * way real MongoDB's `updateOne` reports `matchedCount: 0` rather
     * than throwing. Pass `{ upsert: true }` to insert a new document
     * instead when nothing matches — see {@link UpdateOneOptions}.
     */
    async updateOne(query, update, options = {}) {
        return this.client.request("POST", this.path("/updateOne"), {
            filter: query,
            update,
            upsert: !!options.upsert,
        });
    }
    /**
     * Polls for document writes (`insert`/`replace`/`delete` — via any
     * route, including `updateOne` and `bulkWrite`) since `since` (the
     * `cursor` a previous call returned; omit for "everything still
     * buffered"). **Not** a push connection — no change-stream cursor,
     * no WebSocket/SSE; call this again periodically for near-real-time
     * updates. The gateway only keeps the most recent events per
     * collection (in memory, lost on restart) — polling infrequently
     * enough to fall behind that buffer means silently missing events,
     * with no error marking the gap. See `CHEATSHEET.md` for the exact
     * limitations.
     */
    async changes(since = 0) {
        return this.client.request("POST", this.path("/changes"), { since });
    }
    /**
     * Finds the first document matching `query` and deletes it — unlike
     * `findOne` followed by `deleteOne`, this happens atomically under a
     * single write lock on the gateway, so no other write can land on
     * this collection in between. Returns the deleted document's prior
     * value, or `null` if nothing matched.
     */
    async findOneAndDelete(query = {}) {
        return this.orNullOn404(this.client.request("POST", this.path("/findOneAndDelete"), query));
    }
    /**
     * Finds the first document matching `query` and replaces it wholesale
     * with `replacement` — atomically, like {@link findOneAndDelete}.
     * There's no `findOneAndUpdate`: NemaDb has no partial `$set`-style
     * update, only whole-document replace (same reasoning as
     * {@link replaceOne}). Returns the document's value *before* the
     * replace, or `null` if nothing matched.
     */
    async findOneAndReplace(query, replacement) {
        return this.orNullOn404(this.client.request("POST", this.path("/findOneAndReplace"), {
            filter: query,
            replacement,
        }));
    }
    /**
     * Applies a batch of insert/replace/delete operations as one atomic
     * unit — if any operation fails (a unique-index conflict, say),
     * **none** of the batch is written, not even the operations before
     * it. That's a stronger guarantee than real MongoDB's own
     * `bulkWrite`, which applies operations one at a time and (even in
     * its default `ordered: true` mode) leaves everything before a
     * failing operation committed. There's no bulk `updateOne` — same
     * reason `updateOne` itself doesn't exist (see {@link replaceOne}).
     *
     * Returns one result per operation, in order: `{ insertedId }` for
     * `insertOne`, `{ matched }` for `replaceOne`/`deleteOne` (`matched`
     * is `false`, not an error, if that id didn't exist — a no-op, same
     * as `replaceOne`/`deleteOne` themselves).
     */
    async bulkWrite(operations) {
        return this.client.request("POST", this.path("/bulkWrite"), operations);
    }
    async orNullOn404(promise) {
        try {
            return await promise;
        }
        catch (e) {
            if (e instanceof errors_1.NemaError && e.status === 404)
                return null;
            throw e;
        }
    }
}
exports.NemaCollection = NemaCollection;
