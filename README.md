# NemaJS

A Node.js / TypeScript client for [NemaDb](../NemaDb) — talks to the
`nemadb-gateway` HTTP API exactly the way the Workbench and NemaDb's
own shell do (plain HTTP/JSON, no custom wire protocol to
reimplement). Not published to npm — this is a local package, meant to
be installed by path into whatever project uses it.

Coming from the MongoDB Node driver? See **[CHEATSHEET.md](./CHEATSHEET.md)**
first — a section-by-section comparison against the standard MongoDB
cheat sheet, marking exactly what NemaDb supports today and what it
genuinely doesn't (no partial updates, no sort/limit/skip, no compound
indexes, and more) rather than letting you find out by trial and error.

## Prerequisites

A NemaDb gateway must already be running:

```bash
cargo run -p gateway -- --data ./data_gateway --addr 127.0.0.1:8070
```

## Installing into your project

From your project's directory:

```bash
npm install "../NemaJS"
```

(adjust the relative path to wherever this folder actually sits). npm
builds it automatically on install (via its `prepare` script), so
there's no separate build step to remember. To pick up changes made to
NemaJS later, either re-run that install command or run `npm run
build` inside this folder if you're using `npm link` instead.

## Usage

Two equivalent styles — pick whichever reads better to you, or mix
them; both call the exact same gateway routes underneath.

**MongoDB-familiar style** — `db.<collectionName>` works without ever
calling `.collection(...)` first, the same way `mongosh` lets you type
`db.posts` for any collection name:

```js
const { NemaClient } = require("nemajs");

async function main() {
  const client = new NemaClient({ url: "http://127.0.0.1:8070" });
  await client.createDatabase("blog");
  const db = client.db("blog");

  await db.posts.insertOne({ title: "Hello, NemaDb", category: "News" });
  await db.posts.insertOne({ title: "Season Recap", category: "Sports" });

  console.log(await db.posts.find());                      // every post
  console.log(await db.posts.find({ category: "News" }));  // just the News ones
  console.log(await db.posts.findOne({ category: "News" })); // just the first match, or null

  const post = await db.posts.findOne({ category: "News" });
  await db.posts.replaceOne(post._id, { title: "Hello, NemaDb (updated)", category: "News" });
  await db.posts.deleteOne(post._id);
}

main();
```

**Explicit style** — NemaDb's own shorter verbs, same as the
Workbench/shell/HTTP API use:

```js
const { NemaClient, NemaError } = require("nemajs");

async function main() {
  const client = new NemaClient({ url: "http://127.0.0.1:8070" });
  // const client = new NemaClient({ url: "...", apiKey: "..." }); // if the gateway requires one

  await client.createDatabase("shop");
  const users = client.db("shop").collection("users");

  const { _id } = await users.insert({ name: "Ali", age: 30 });
  const user = await users.get(_id);
  const adults = await users.find({ age: { $gte: 18 } });

  await users.createIndex("email", { unique: true });
  try {
    await users.insert({ email: "ali@example.com" });
    await users.insert({ email: "ali@example.com" }); // rejected
  } catch (e) {
    if (e instanceof NemaError && e.status === 409) {
      console.log("duplicate email rejected");
    }
  }
}

main();
```

See `examples/mongo-style.js` and `examples/basic.js` for full,
runnable versions of each. TypeScript works the same way either way —
full type declarations ship in `dist/`:

```ts
import { NemaClient, NemaDocument } from "nemajs";

const client = new NemaClient({ url: "http://127.0.0.1:8070" });
const users = client.db("shop").collection("users");
const doc: NemaDocument | null = await users.get(someId);
```

## API

- `new NemaClient({ url, apiKey? })`
- `client.health()`, `client.listDatabases()`, `client.createDatabase(name)`, `client.dropDatabase(name)`
- `client.db(name)` → `NemaDatabase`
  - `db.listCollections()`, `db.createCollection(name)`, `db.dropCollection(name)`
  - `db.collection(name)` → `NemaCollection` — or just `db.<name>` for any collection name (`db.posts`, `db.orders`, ...); both return the exact same thing
    - `insert(doc)` / `insertOne(doc)` — identical, `insertOne` is the MongoDB-familiar name
    - `get(id)` — fetch by id, `null` if missing
    - `replace(id, doc)` / `replaceOne(id, doc)` — whole-document replace (not a partial `$set`-style update — NemaDb doesn't have one), `null` if `id` doesn't exist, otherwise the *previous* value
    - `delete(id)` / `deleteOne(id)` — `null` if `id` didn't exist
    - `find(query?)` — omit `query` (or pass `{}`) to match everything
    - `findOne(query?)` — like `find`, but just the first match or `null`; still fetches every match under the hood, not a server-side optimization
    - `findOneAndDelete(query)` — atomically finds the first match and deletes it, returning its prior value (or `null`)
    - `findOneAndReplace(query, replacement)` — atomically finds the first match and replaces it wholesale, returning its prior value (or `null`)
    - `bulkWrite(operations)` — applies a batch of `insertOne`/`replaceOne`/`deleteOne` operations atomically (all-or-nothing); see `CHEATSHEET.md` §24 for the operation shapes and result format
    - `updateOne(query, update, { upsert? })` — partial update (`$set`/`$unset`/`$inc`/`$mul`/`$min`/`$max`/`$rename`/`$push`/`$addToSet`/`$pull`/`$pop`); returns `{ matched, modified, upsertedId }`, not a document — see `CHEATSHEET.md` §15–17/§23
    - `count(query?)` — server-side; omit `query` to count the whole collection
    - `distinct(field, query?)` — server-side; the distinct values `field` takes across matches (or the whole collection)
    - `aggregate(pipeline)`
    - `createIndex(field, { unique? })`
- `NemaError` — thrown for any non-2xx gateway response; has `.status` and `.message`

There's no `insertMany` by that name, but `bulkWrite([{ insertOne: { document } }, ...])`
covers the same multi-insert case — and atomically, which real
MongoDB's `insertMany` isn't by default. `updateMany` doesn't exist
either (`updateOne` only touches the first match) — loop `updateOne`
if you need to touch every match.

See the Workbench's in-app **Guide & Queries** page for the full query
operator (`$eq`/`$gt`/`$in`/`$exists`/`$and`/`$or`/`$size`/`$all`/
`$elemMatch`/...) and aggregation stage (`$match`/`$project`/`$group`)
reference — this package just carries whatever query/pipeline object
you build over to the gateway unchanged.

## Testing this package itself

```bash
npm test
```

Runs `test/live.test.js` against a real gateway (`NEMADB_URL` env var,
default `http://127.0.0.1:8070`) — creates a uniquely-named scratch
database, exercises every method, and drops it again. Requires a
gateway to actually be running; nothing here is mocked.
