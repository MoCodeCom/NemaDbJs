# NemaJS vs. the MongoDB Node.js driver — an honest cheat sheet

Mirrors the standard MongoDB Node driver cheat sheet, section by
section, so it's easy to compare directly. Every ✅ example below is
real, runnable NemaJS code. Every ❌ section is something **NemaDb
itself does not support yet** — not a NemaJS limitation, a database
one — listed here so nothing is silently missing without an
explanation. Nothing in this file was written from memory; the
supported/unsupported line for each operator was checked directly
against NemaDb's actual query parser and gateway routes.

---

## 1. Connect

✅

```js
const { NemaClient } = require("nemajs");

const client = new NemaClient({ url: "http://127.0.0.1:8070" });
// const client = new NemaClient({ url: "...", apiKey: "..." }); // if the gateway requires one

const db = client.db("myDatabase");
const users = db.collection("users"); // or just db.users
```

No `.connect()` call needed — there's no persistent connection to
open; every call is a plain HTTP request.

## 2. Create

✅ `insertOne` (alias for `insert`):

```js
await users.insertOne({ name: "John", age: 25, email: "john@example.com" });
```

✅ Insert with your own `_id` (must be a string):

```js
await users.insertOne({ _id: "user123", name: "John" });
```

❌ **`insertMany`** — the gateway has no bulk-insert route. Loop and
call `insertOne` per document if you need to insert several.

## 3. Read

✅ `find` / `findOne` — already return a plain array/object, no
`.toArray()`:

```js
const all = await users.find({});
const john = await users.findOne({ email: "john@example.com" });
```

❌ **Find by MongoDB `ObjectId`** — NemaDb's ids are UUID strings, not
BSON `ObjectId`s. Just pass the string:

```js
const user = await users.get("77b71261-3f97-4563-96b7-b3055b634307");
```

## 4. Comparison operators

✅ All eight, exactly as MongoDB spells them:

```js
await users.find({ age: { $eq: 25 } });
await users.find({ age: { $ne: 25 } });
await users.find({ age: { $gt: 25 } });
await users.find({ age: { $gte: 25 } });
await users.find({ age: { $lt: 30 } });
await users.find({ age: { $lte: 30 } });
await users.find({ age: { $in: [20, 25, 30] } });
await users.find({ age: { $nin: [20, 25, 30] } });
```

**Gotcha** (NemaDb, not MongoDB): a missing field makes *every*
operator false, including `$ne` — MongoDB treats a missing field as
"not equal" and matches it; NemaDb never does.

## 5. Logical operators

✅ `$and` / `$or` (top-level only — not nested inside a field):

```js
await users.find({ $and: [{ age: { $gte: 18 } }, { age: { $lte: 30 } }] });
await users.find({ $or: [{ age: 20 }, { age: 30 }] });

// Usually simplified to (works the same way it does in MongoDB):
await users.find({ age: { $gte: 18, $lte: 30 } });
```

❌ **`$nor`, `$not`** — not implemented.

## 6. Element operators

✅ `$exists`:

```js
await users.find({ phone: { $exists: true } });
await users.find({ phone: { $exists: false } });
```

❌ **`$type`** — not implemented (NemaDb documents are schema-less but
there's no way to query *by* stored type).

## 7. Array queries

✅ `$size`, `$all`, `$elemMatch`:

```js
await users.find({ skills: { $size: 3 } });
await users.find({ skills: { $all: ["mongodb", "node"] } });

// against an array of scalars — operators apply straight to each element
await users.find({ scores: { $elemMatch: { $gte: 80, $lt: 90 } } });

// against an array of sub-documents — fields apply to each element
await users.find({ items: { $elemMatch: { sku: "A1", qty: { $gte: 5 } } } });
```

❌ A plain `{ skills: "MongoDB" }` array-contains-value shorthand isn't
implemented — use `$elemMatch` (`{ skills: { $elemMatch: { $eq: "MongoDB" } } }`)
or `$all` with a single-element array instead.

## 8. String / regex queries

❌ **`$regex`/`$options`** — not implemented. No substring or
case-insensitive matching at the query level at all.

## 9. Projection

❌ **Not implemented** — `find`/`findOne` always return the whole
document. Filter fields yourself client-side if needed:

```js
const docs = await users.find({});
const namesOnly = docs.map(({ name, email }) => ({ name, email }));
```

## 10–12. Sort / limit / skip / pagination

❌ **None of these exist** — `find` returns every match, in whatever
order the collection's underlying storage produces (not guaranteed,
not sorted). No pagination support at the gateway at all. For a small
result set, sort/slice client-side:

```js
const docs = (await users.find({})).sort((a, b) => a.age - b.age);
const page = docs.slice((pageNum - 1) * pageSize, pageNum * pageSize);
```

This does not scale the way real pagination would — it still fetches
every matching document over the wire first.

## 13. Count

✅ Server-side — matched documents are counted on the gateway and
never sent over the wire:

```js
const count = await users.count({ age: { $gte: 18 } });
const total = await users.count(); // whole collection
```

## 14. Distinct

✅ Server-side, same as `count`. Dotted paths work the same as
everywhere else in NemaDb's queries:

```js
const cities = await users.distinct("address.city");
const activeCities = await users.distinct("address.city", { status: "active" });
```

## 15–17. Update operations, update operators, upsert

✅ `updateOne` with `$set`/`$unset`/`$inc`/`$mul`/`$min`/`$max`/
`$rename`, plus the array operators `$push`/`$addToSet`/`$pull`/`$pop`
(§23). Atomic — the gateway finds the match and writes it back under
one lock:

```js
await users.updateOne(
  { email: "john@example.com" },
  { $set: { age: 26 }, $inc: { loginCount: 1 } }
);
// { matched: true, modified: true, upsertedId: null }
```

A no-match is **not** an error — `matched` comes back `false`, same as
real MongoDB reporting `matchedCount: 0`. Pass `{ upsert: true }` to
insert instead: the new document is seeded from the filter's own
top-level equality fields (`{ status: "active" }` seeds `status:
"active"`; a `$gte`/`$or`/etc. clause seeds nothing, since it doesn't
pin down one concrete value), with the update's operators applied on
top:

```js
await users.updateOne(
  { email: "new@example.com" },
  { $set: { name: "New Guy" } },
  { upsert: true }
); // { matched: false, modified: false, upsertedId: "<new id>" }
```

❌ **`updateMany`** — no bulk-update route; loop `updateOne` (or use
`bulkWrite`, though that only offers `insertOne`/`replaceOne`/
`deleteOne`, not an update operator batch). **`$currentDate`** isn't
implemented either — no clock-derived values anywhere else in NemaDb
to be consistent with. Update operators only apply to fields that
exist as scalars/arrays already shaped correctly — e.g. `$inc` on a
field holding a string is a silent no-op rather than an error, same
spirit as `Filter`'s own "wrong shape = doesn't match" stance.

## 18. Replace document

✅ `replace` / `replaceOne` — whole-document replace, not an upsert
(returns `null` and changes nothing if the id doesn't exist):

```js
const previous = await users.replaceOne(id, { name: "John", age: 30, email: "john@example.com" });
```

Same warning MongoDB's own docs give: fields not included in the
replacement are gone.

## 19–21. `findOneAndUpdate` / `findOneAndDelete` / `findOneAndReplace`

✅ `findOneAndDelete` / `findOneAndReplace` — genuinely atomic: the
gateway does the filter-match-then-delete/replace itself under a
single write lock, so (unlike a client-side `findOne` then
`deleteOne`/`replaceOne`) no other write can land on the matched
document in between:

```js
await users.findOneAndDelete({ email: "john@example.com" });
await users.findOneAndReplace(
  { email: "john@example.com" },
  { name: "John", age: 26, email: "john@example.com" }
);
```

Both return the matched document's value *before* the delete/replace,
or `null` if nothing matched.

❌ **`findOneAndUpdate`** has no direct equivalent, but `updateOne`
(§15–17) now covers the same "match by filter, apply a partial
update" need — it just isn't atomic-and-returns-the-old-document in
one call the way `findOneAndUpdate` is; it returns
`{ matched, modified, upsertedId }` instead of a document.

## 22. Delete operations

✅ `delete` / `deleteOne`:

```js
await users.deleteOne(id);
```

❌ **`deleteMany`** — no bulk-delete route. Loop over a `find` result:

```js
const toDelete = await users.find({ status: "inactive" });
for (const doc of toDelete) await users.deleteOne(doc._id);
```

Not atomic, and not efficient for a large match set — it's N HTTP
round trips.

## 23. Array update operators

✅ `$push`, `$addToSet`, `$pull`, `$pop`:

```js
await users.updateOne({ _id: id }, { $push: { tags: "urgent" } });
await users.updateOne({ _id: id }, { $addToSet: { tags: "urgent" } }); // no-op if already present
await users.updateOne({ _id: id }, { $pull: { tags: "urgent" } });     // removes every exact match
await users.updateOne({ _id: id }, { $pop: { tags: 1 } });             // 1 = last, -1 = first
```

❌ **`$pull` with a condition** (`{ $pull: { scores: { $gt: 90 } } }`)
— only exact-value matching is supported, not a sub-query per element
(same kind of scope cut as `$elemMatch`, just the write-side version).
**`$push` with `$each`/`$sort`/`$slice`** and **`$[]`/`$[<identifier>]`
positional operators** aren't implemented either — `$push` always
appends exactly one value.

## 24. Bulk operations (`bulkWrite`)

✅ `insertOne`/`replaceOne`/`deleteOne` only (no bulk `updateOne` — same
reason `updateOne` itself doesn't exist, see §15–17). Genuinely atomic:
the whole batch commits or rolls back as one unit, via NemaDb's
existing (Rust-only until now) transaction primitive — actually a
*stronger* guarantee than real MongoDB's own `bulkWrite`, which applies
operations one at a time and, even in its default `ordered: true`
mode, leaves everything before a failing operation committed:

```js
const results = await users.bulkWrite([
  { insertOne: { document: { name: "Zara", age: 50 } } },
  { replaceOne: { id: someId, replacement: { name: "Ali", age: 31 } } },
  { deleteOne: { id: anotherId } },
]);
// [{ insertedId: "..." }, { matched: true }, { matched: true }]

// if ANY op fails (e.g. a unique-index conflict), NONE of the batch
// is written — not even the ops before the failing one:
await users.bulkWrite([
  { insertOne: { document: { name: "Zara" } } },      // would succeed alone...
  { insertOne: { document: { name: "Zara" } } },      // ...but this violates the unique index
]); // rejects with a 409 NemaError, and neither insert lands
```

## 25–29. Aggregation, `$match`, `$group`, `$project`

✅ Real, but only these three stages:

```js
const result = await users.aggregate([
  { $match: { age: { $gte: 18 } } },
  { $group: { _id: "$city", total: { $sum: 1 } } },
]);
```

`$group` accumulators supported: `$sum`, `$avg`, `$min`, `$max`. No
`$push`/`$addToSet` accumulator. `$project` reshapes/includes fields
and can reference another field with `"$fieldName"`, but has none of
MongoDB's computed-expression operators (no `$multiply`, `$concat`,
date functions, `$cond`, etc. — see §33).

## 26 / 30–32. Other aggregation stages (`$sort`, `$limit`, `$lookup`, `$unwind`, `$facet`, ...)

❌ **None implemented.** `$lookup` and `$unwind` specifically were
evaluated for NemaDb and deliberately deferred (recorded in the
engine's own design log) — real work, not forgotten.

## 33. Aggregation expressions

❌ **None** beyond the four `$group` accumulators above — no
arithmetic (`$add`/`$multiply`/...), string (`$concat`/`$toUpper`/...),
date, or conditional (`$cond`/`$ifNull`) expressions.

## 34. Index operations

✅ Single-field index, optionally unique:

```js
await users.createIndex("email");
await users.createIndex("email", { unique: true });
```

❌ **Compound indexes** (`{ city: 1, age: -1 }`), **text indexes**,
**`listIndexes()`**, **`dropIndex()`** — none of these exist. NemaDb's
storage engine has the underlying methods in Rust
(`index_names`/`drop_index`) but nothing exposes them over HTTP yet.

## 35. `explain()`

❌ Exists internally in NemaDb's Rust query planner
(`query::explain`), not reachable from NemaJS or any HTTP route.

## 36. Transactions

⚠️ NemaDb genuinely has transactions (`storage::Transaction`,
begin/commit/rollback, atomic across collections) — but only as a Rust
API. There's no HTTP route or wire-protocol message for starting one,
so **NemaJS (or any non-Rust code) cannot use them at all.**

## 37. Database operations

✅ The subset that exists:

```js
await client.listDatabases();
await client.createDatabase("shop");
await client.dropDatabase("shop");

const db = client.db("shop");
await db.listCollections();       // [{ name, count }, ...]
await db.createCollection("users");
await db.dropCollection("users");
```

❌ No collection **rename**.

## 38. Collection operations — summary

| MongoDB | NemaJS | Notes |
|---|---|---|
| `insertOne` | `insert` / `insertOne` | |
| `insertMany` | ❌ | |
| `find` | `find` | no sort/limit/skip/projection |
| `findOne` | `findOne` | client-side "first of `find`" |
| `findOneAndUpdate/Delete/Replace` | `updateOne` / `findOneAndDelete` / `findOneAndReplace` | delete/replace are genuinely atomic; updateOne doesn't return the matched document |
| `updateOne` / `updateMany` | `updateOne` / ❌ | `$set`/`$unset`/`$inc`/`$mul`/`$min`/`$max`/`$rename`/`$push`/`$addToSet`/`$pull`/`$pop`, upsert supported; no bulk updateMany |
| `replaceOne` | `replace` / `replaceOne` | |
| `deleteOne` | `delete` / `deleteOne` | |
| `deleteMany` | ❌ | loop `deleteOne` |
| `countDocuments` / `estimatedDocumentCount` | `count` | server-side |
| `distinct` | `distinct` | server-side |
| `aggregate` | `aggregate` | `$match`/`$project`/`$group` only |
| `bulkWrite` | `bulkWrite` | insertOne/replaceOne/deleteOne only; atomic (all-or-nothing) |
| `createIndex` | `createIndex` | single field only |
| `createIndexes` / `listIndexes` / `dropIndex` / `dropIndexes` | ❌ | |
| `rename` / `drop` | ❌ / `dropCollection` | |
| `watch` | ❌ | |

## 39. Change streams

❌ **Not implemented** — no real-time change notification mechanism
exists anywhere in NemaDb.

## 40. Geospatial queries

❌ **Not implemented** — no geo indexing, `$near`/`$geoWithin`/
`$geoIntersects`/etc.

---

## The honest short version

**Solid today**: insert/get/replace/delete by id, `find`/`findOne`
with `$eq`/`$ne`/`$gt`/`$gte`/`$lt`/`$lte`/`$in`/`$nin`/`$exists`/
`$and`/`$or`/`$size`/`$all`/`$elemMatch`, atomic `findOneAndDelete`/
`findOneAndReplace`/`bulkWrite`, partial updates via `updateOne`
(`$set`/`$unset`/`$inc`/`$mul`/`$min`/`$max`/`$rename`/`$push`/
`$addToSet`/`$pull`/`$pop`, with upsert), server-side `count`/
`distinct`, single-field (optionally unique) indexes, and a 3-stage
(`$match`/`$project`/`$group`) aggregation pipeline. Durable, tested,
verified against a real running gateway.

**Not there yet**: `updateMany`, projection, sort/limit/skip,
compound/text indexes, index management beyond create, most
aggregation stages, transactions outside Rust (bulkWrite is the one
place they're exposed, internally), change streams, geospatial. Most
of this is real new engine work (the `query` crate and the gateway),
not something NemaJS can paper over with a client-side trick — the
workarounds shown above where one exists are real but come with real
caveats (non-atomic, fetch-everything-then-filter), not silent
equivalents.
