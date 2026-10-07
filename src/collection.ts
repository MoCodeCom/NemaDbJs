import { RequestExecutor } from "./internal";
import { NemaError } from "./errors";

/** A NemaDb document — `_id` shows up as a string field once inserted. */
export type NemaDocument = Record<string, unknown> & { _id?: string };

/** A NemaDb query document, e.g. `{ age: { "$gte": 18 } }`. */
export type NemaQuery = Record<string, unknown>;

/** One stage of an aggregation pipeline, e.g. `{ "$match": {...} }`. */
export type PipelineStage = Record<string, unknown>;

/** One operation in a {@link NemaCollection.bulkWrite} batch. */
export type BulkWriteOp =
  | { insertOne: { document: NemaDocument } }
  | { replaceOne: { id: string; replacement: NemaDocument } }
  | { deleteOne: { id: string } };

/** One per-operation outcome from {@link NemaCollection.bulkWrite}, in the same order as the input. */
export type BulkWriteResult = { insertedId: string } | { matched: boolean };

/**
 * An update document for {@link NemaCollection.updateOne} — e.g.
 * `{ $set: { age: 31 }, $inc: { views: 1 } }`. Every top-level key
 * must be one of the operators below; there's no fallback
 * interpretation as a whole-document replacement (that's
 * {@link NemaCollection.replaceOne}).
 */
export type NemaUpdate = {
  $set?: Record<string, unknown>;
  $unset?: Record<string, unknown>;
  $inc?: Record<string, number>;
  $mul?: Record<string, number>;
  $min?: Record<string, unknown>;
  $max?: Record<string, unknown>;
  $push?: Record<string, unknown>;
  $addToSet?: Record<string, unknown>;
  $pull?: Record<string, unknown>;
  $pop?: Record<string, 1 | -1>;
  $rename?: Record<string, string>;
};

export interface UpdateOneOptions {
  /** If nothing matches `query`, insert a new document instead — seeded from `query`'s own top-level equality fields, with `update` applied on top. */
  upsert?: boolean;
}

export interface UpdateOneResult {
  /** Whether a document matched `query` (independent of whether the update actually changed it). */
  matched: boolean;
  /** Whether the matched document's value actually changed (`false` for a no-op update, e.g. `$set` to its current value). */
  modified: boolean;
  /** The id of the document `upsert` inserted, or `null` if nothing was upserted. */
  upsertedId: string | null;
}

/** One document write reported by {@link NemaCollection.changes}. */
export interface ChangeEvent {
  /** Monotonically increasing within this collection — pass the highest `seq` you've seen back as `since` on your next call. */
  seq: number;
  operation: "insert" | "replace" | "delete";
  /** The changed document's `_id`. */
  id: string;
  /** The document's new value for `insert`/`replace`, or `null` for `delete`. */
  document: NemaDocument | null;
}

export interface CreateIndexOptions {
  /**
   * Rejects any insert/replace that would duplicate an existing value
   * at this field, instead of just accelerating lookups. Creating one
   * itself fails (unchanged) if the collection already has two
   * documents sharing a value there.
   */
  unique?: boolean;
}

/**
 * A handle to one collection within one database. Cheap to create —
 * it holds no connection state of its own, just names — so there's no
 * need to cache what `db.collection(name)` returns.
 */
export class NemaCollection {
  constructor(
    private readonly client: RequestExecutor,
    private readonly databaseName: string,
    public readonly name: string
  ) {}

  private path(suffix = ""): string {
    return `/databases/${encodeURIComponent(this.databaseName)}/collections/${encodeURIComponent(
      this.name
    )}${suffix}`;
  }

  /** Inserts `doc`, assigning it an `_id` if it doesn't have one. */
  async insert(doc: NemaDocument): Promise<{ _id: string }> {
    return this.client.request("POST", this.path(), doc);
  }

  /** Fetches a document by id, or `null` if no such document exists. */
  async get(id: string): Promise<NemaDocument | null> {
    return this.orNullOn404(this.client.request<NemaDocument>("GET", this.path(`/${encodeURIComponent(id)}`)));
  }

  /**
   * Replaces the document at `id` wholesale, keeping its original
   * `_id` regardless of what `doc` carries. Not an upsert — returns
   * `null` (and changes nothing) if `id` doesn't exist. On success,
   * returns the *previous* value.
   */
  async replace(id: string, doc: NemaDocument): Promise<NemaDocument | null> {
    return this.orNullOn404(
      this.client.request<NemaDocument>("PUT", this.path(`/${encodeURIComponent(id)}`), doc)
    );
  }

  /** Deletes the document at `id`, returning it, or `null` if it didn't exist. */
  async delete(id: string): Promise<NemaDocument | null> {
    return this.orNullOn404(this.client.request<NemaDocument>("DELETE", this.path(`/${encodeURIComponent(id)}`)));
  }

  /** Finds every document matching `query` (`{}` matches everything). */
  async find(query: NemaQuery = {}): Promise<NemaDocument[]> {
    return this.client.request("POST", this.path("/find"), query);
  }

  /** Runs an aggregation pipeline (`$match`/`$project`/`$group`) over this collection. */
  async aggregate(pipeline: PipelineStage[]): Promise<NemaDocument[]> {
    return this.client.request("POST", this.path("/aggregate"), pipeline);
  }

  /**
   * Counts documents matching `query` (`{}` counts the whole
   * collection) — server-side: the matched documents are counted on
   * the gateway and never sent over the wire, unlike
   * `(await find(query)).length`.
   */
  async count(query: NemaQuery = {}): Promise<number> {
    const { count } = await this.client.request<{ count: number }>("POST", this.path("/count"), query);
    return count;
  }

  /**
   * The distinct values `field` takes on across documents matching
   * `query` (`{}` — the default — considers the whole collection).
   * Server-side, like {@link count}. `field` supports dotted paths
   * (`"address.city"`), same as everywhere else in NemaDb's queries.
   */
  async distinct(field: string, query: NemaQuery = {}): Promise<unknown[]> {
    return this.client.request("POST", this.path("/distinct"), { field, filter: query });
  }

  /**
   * Builds a secondary index on `field` (dotted paths like
   * `"address.city"` work). Pass `{ unique: true }` to also enforce
   * uniqueness — see `CreateIndexOptions`.
   */
  async createIndex(field: string, options: CreateIndexOptions = {}): Promise<void> {
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
  async insertOne(doc: NemaDocument): Promise<{ _id: string }> {
    return this.insert(doc);
  }

  /**
   * Like {@link find}, but returns just the first match (or `null`)
   * instead of an array. Implemented client-side — NemaDb's gateway
   * has no dedicated "first match only" endpoint, so this still fetches
   * every match under the hood and isn't a real optimization for a
   * large result set.
   */
  async findOne(query: NemaQuery = {}): Promise<NemaDocument | null> {
    const results = await this.find(query);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Alias for {@link replace} — a whole-document replace, the same
   * thing MongoDB itself calls `replaceOne`. Takes an id directly, not
   * a filter (unlike real MongoDB's `replaceOne`) — NemaDb's gateway
   * only supports replace-by-id.
   */
  async replaceOne(id: string, doc: NemaDocument): Promise<NemaDocument | null> {
    return this.replace(id, doc);
  }

  /**
   * Alias for {@link delete}. Takes an id directly, not a filter
   * (unlike real MongoDB's `deleteOne`) — NemaDb's gateway only
   * supports delete-by-id.
   */
  async deleteOne(id: string): Promise<NemaDocument | null> {
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
  async updateOne(query: NemaQuery, update: NemaUpdate, options: UpdateOneOptions = {}): Promise<UpdateOneResult> {
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
  async changes(since = 0): Promise<{ events: ChangeEvent[]; cursor: number }> {
    return this.client.request("POST", this.path("/changes"), { since });
  }

  /**
   * Finds the first document matching `query` and deletes it — unlike
   * `findOne` followed by `deleteOne`, this happens atomically under a
   * single write lock on the gateway, so no other write can land on
   * this collection in between. Returns the deleted document's prior
   * value, or `null` if nothing matched.
   */
  async findOneAndDelete(query: NemaQuery = {}): Promise<NemaDocument | null> {
    return this.orNullOn404(this.client.request<NemaDocument>("POST", this.path("/findOneAndDelete"), query));
  }

  /**
   * Finds the first document matching `query` and replaces it wholesale
   * with `replacement` — atomically, like {@link findOneAndDelete}.
   * There's no `findOneAndUpdate`: NemaDb has no partial `$set`-style
   * update, only whole-document replace (same reasoning as
   * {@link replaceOne}). Returns the document's value *before* the
   * replace, or `null` if nothing matched.
   */
  async findOneAndReplace(query: NemaQuery, replacement: NemaDocument): Promise<NemaDocument | null> {
    return this.orNullOn404(
      this.client.request<NemaDocument>("POST", this.path("/findOneAndReplace"), {
        filter: query,
        replacement,
      })
    );
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
  async bulkWrite(operations: BulkWriteOp[]): Promise<BulkWriteResult[]> {
    return this.client.request("POST", this.path("/bulkWrite"), operations);
  }

  private async orNullOn404<T>(promise: Promise<T>): Promise<T | null> {
    try {
      return await promise;
    } catch (e) {
      if (e instanceof NemaError && e.status === 404) return null;
      throw e;
    }
  }
}
