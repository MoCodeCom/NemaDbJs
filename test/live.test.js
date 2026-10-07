// Real end-to-end test: a real NemaDb gateway must already be running
// at NEMADB_URL (default http://127.0.0.1:8070) — not mocked. Run
// with `npm test`.

const assert = require("node:assert");
const { NemaClient, NemaError } = require("../dist/index.js");

const URL = process.env.NEMADB_URL || "http://127.0.0.1:8070";
const DB_NAME = `nemajs_test_${Date.now()}`;

async function main() {
  const client = new NemaClient({ url: URL });

  assert.strictEqual(await client.health(), true, "gateway must be reachable at " + URL);

  // ---- database / collection management ----
  await client.createDatabase(DB_NAME);
  assert.ok((await client.listDatabases()).includes(DB_NAME), "created database must be listed");

  const db = client.db(DB_NAME);
  await db.createCollection("users");
  let cols = await db.listCollections();
  assert.deepStrictEqual(
    cols.map((c) => c.name),
    ["users"]
  );
  assert.strictEqual(cols[0].count, 0);

  const users = db.collection("users");

  // ---- CRUD ----
  const { _id } = await users.insert({ name: "Ali", age: 30 });
  assert.ok(_id, "insert must return an _id");

  const fetched = await users.get(_id);
  assert.strictEqual(fetched.name, "Ali");
  assert.strictEqual(fetched.age, 30);
  assert.strictEqual(fetched._id, _id);

  const previous = await users.replace(_id, { name: "Ali", age: 31 });
  assert.strictEqual(previous.age, 30, "replace must return the previous value");
  assert.strictEqual((await users.get(_id)).age, 31);

  await users.insert({ name: "Sara", age: 22 });

  // ---- find ----
  const adults = await users.find({ age: { $gte: 25 } });
  assert.strictEqual(adults.length, 1);
  assert.strictEqual(adults[0].name, "Ali");

  const everyone = await users.find();
  assert.strictEqual(everyone.length, 2, "find() with no query must match everything");

  // Regression: a top-level {_id: "..."} filter must resolve to
  // exactly that one document, not silently degrade to "match
  // everything" — only catchable with >1 document in the collection,
  // since a single-document collection can't tell the two apart.
  const byId = await users.find({ _id });
  assert.strictEqual(byId.length, 1, "{_id: ...} must match exactly the one document with that id");
  assert.strictEqual(byId[0].name, "Ali");

  // ---- unique index ----
  await users.createIndex("name", { unique: true });
  await assert.rejects(
    () => users.insert({ name: "Ali", age: 99 }),
    (e) => e instanceof NemaError && e.status === 409,
    "inserting a duplicate on a unique index must reject with 409"
  );

  // ---- aggregate ----
  const [agg] = await users.aggregate([
    { $group: { _id: null, avgAge: { $avg: "$age" } } },
  ]);
  assert.strictEqual(agg.avgAge, (31 + 22) / 2);

  // ---- delete ----
  const deleted = await users.delete(_id);
  assert.strictEqual(deleted.name, "Ali");
  assert.strictEqual(await users.get(_id), null, "get after delete must return null, not throw");
  assert.strictEqual(await users.delete(_id), null, "deleting an already-deleted id must return null");

  // ---- MongoDB-familiar aliases + dynamic db.<collection> access ----
  // db.posts is never explicitly created — mirrors the user-facing
  // example this is meant to prove: db.posts.insertOne(...) just works,
  // implicit collection creation and all, the same as db.collection("posts").
  await db.posts.insertOne({ title: "Hello", category: "News" });
  await db.posts.insertOne({ title: "Sports Recap", category: "Sports" });

  const allPosts = await db.posts.find();
  assert.strictEqual(allPosts.length, 2, "db.posts.find() must see both inserted posts");

  const newsPosts = await db.posts.find({ category: "News" });
  assert.strictEqual(newsPosts.length, 1);
  assert.strictEqual(newsPosts[0].title, "Hello");

  const oneNews = await db.posts.findOne({ category: "News" });
  assert.strictEqual(oneNews.title, "Hello");
  assert.strictEqual(await db.posts.findOne({ category: "Nonexistent" }), null);

  const prevPost = await db.posts.replaceOne(oneNews._id, { title: "Hello (edited)", category: "News" });
  assert.strictEqual(prevPost.title, "Hello");
  assert.strictEqual((await db.posts.get(oneNews._id)).title, "Hello (edited)");

  const deletedPost = await db.posts.deleteOne(oneNews._id);
  assert.strictEqual(deletedPost.title, "Hello (edited)");
  assert.strictEqual(await db.posts.get(oneNews._id), null);

  // The exact hazard `withDynamicCollections` guards against: if
  // `db.then` returned a collection object instead of `undefined`,
  // `await db` (or anything that does `Promise.resolve(db)`) would
  // treat `db` as a thenable and try to call `.then` as a function —
  // this must never come up, even though "then" would otherwise look
  // like a perfectly normal collection name to ask for.
  assert.strictEqual(db.then, undefined, "db.then must not be treated as a collection name");
  const resolved = await db; // must resolve to `db` itself, not hang or throw
  assert.strictEqual(resolved, db);

  // ---- findOneAndDelete / findOneAndReplace ----
  // Fresh categories not used above ("News"/"Sports" already have a
  // leftover "Sports Recap" post at this point), so each query below
  // matches exactly the one document this block inserts.
  await db.posts.insertOne({ title: "Draft", category: "Drafts", views: 1 });
  await db.posts.insertOne({ title: "Old Archive Post", category: "Archive", views: 2 });

  const replaced = await db.posts.findOneAndReplace(
    { category: "Drafts" },
    { title: "Draft (published)", category: "Drafts", views: 1 }
  );
  assert.strictEqual(replaced.title, "Draft", "findOneAndReplace must return the pre-replace value");
  const afterReplace = await db.posts.findOne({ category: "Drafts" });
  assert.strictEqual(afterReplace.title, "Draft (published)");

  assert.strictEqual(
    await db.posts.findOneAndReplace({ category: "Nonexistent" }, { title: "X" }),
    null,
    "findOneAndReplace must return null when nothing matches"
  );

  const removed = await db.posts.findOneAndDelete({ category: "Archive" });
  assert.strictEqual(removed.title, "Old Archive Post", "findOneAndDelete must return the deleted document");
  assert.strictEqual(await db.posts.findOne({ category: "Archive" }), null, "the matched document must be gone");

  assert.strictEqual(
    await db.posts.findOneAndDelete({ category: "Nonexistent" }),
    null,
    "findOneAndDelete must return null when nothing matches"
  );

  // ---- array queries: $size / $all / $elemMatch ----
  await db.posts.insertOne({ title: "Tagged", category: "Tags", tags: ["a", "b"], scores: [70, 85] });

  assert.strictEqual((await db.posts.find({ tags: { $size: 2 } })).length, 1);
  assert.strictEqual((await db.posts.find({ tags: { $size: 5 } })).length, 0);
  assert.strictEqual((await db.posts.find({ tags: { $all: ["a", "b"] } })).length, 1);
  assert.strictEqual((await db.posts.find({ tags: { $all: ["a", "z"] } })).length, 0);
  assert.strictEqual((await db.posts.find({ scores: { $elemMatch: { $gte: 80, $lt: 90 } } })).length, 1);
  assert.strictEqual((await db.posts.find({ scores: { $elemMatch: { $gte: 95 } } })).length, 0);

  // ---- bulkWrite ----
  await db.posts.insertOne({ title: "Keeper", category: "BulkA", views: 1 });

  const keeper = await db.posts.findOne({ category: "BulkA" });
  const bulkResults = await db.posts.bulkWrite([
    { insertOne: { document: { title: "Bulk 1", category: "BulkB" } } },
    { insertOne: { document: { title: "Bulk 2", category: "BulkB" } } },
    { replaceOne: { id: keeper._id, replacement: { title: "Keeper (updated)", category: "BulkA" } } },
    { deleteOne: { id: "00000000-0000-0000-0000-000000000000" } },
  ]);
  assert.strictEqual(bulkResults.length, 4);
  assert.ok(bulkResults[0].insertedId, "insertOne result must carry an insertedId");
  assert.ok(bulkResults[1].insertedId);
  assert.strictEqual(bulkResults[2].matched, true, "replaceOne on an existing id must report matched: true");
  assert.strictEqual(bulkResults[3].matched, false, "deleteOne on a missing id must report matched: false, not throw");

  const bulkBPosts = await db.posts.find({ category: "BulkB" });
  assert.strictEqual(bulkBPosts.length, 2, "both bulkWrite inserts must have landed");
  assert.strictEqual((await db.posts.get(keeper._id)).title, "Keeper (updated)");

  // A batch with a failing op (duplicate unique "title") must roll
  // back entirely — not even the earlier, individually-valid op lands.
  await db.posts.createIndex("title", { unique: true });
  await assert.rejects(
    () =>
      db.posts.bulkWrite([
        { insertOne: { document: { title: "Never Lands", category: "BulkC" } } },
        { insertOne: { document: { title: "Keeper (updated)", category: "BulkC" } } }, // title collides with the doc above
      ]),
    (e) => e instanceof NemaError && e.status === 409,
    "a unique-index conflict anywhere in the batch must reject with 409"
  );
  assert.strictEqual(
    (await db.posts.find({ category: "BulkC" })).length,
    0,
    "bulkWrite must be all-or-nothing: the op before the failing one must not have landed either"
  );

  // ---- count / distinct ----
  await db.posts.insertOne({ title: "C1", category: "CountA" });
  await db.posts.insertOne({ title: "C2", category: "CountA" });
  await db.posts.insertOne({ title: "C3", category: "CountB" });

  assert.strictEqual(await db.posts.count({ category: "CountA" }), 2);
  assert.strictEqual(await db.posts.count({ category: "CountB" }), 1);
  assert.strictEqual(await db.posts.count({ category: "Nonexistent" }), 0);

  const distinctCategories = await db.posts.distinct("category", {
    category: { $in: ["CountA", "CountB"] },
  });
  assert.strictEqual(distinctCategories.length, 2);
  assert.ok(distinctCategories.includes("CountA"));
  assert.ok(distinctCategories.includes("CountB"));

  assert.deepStrictEqual(await db.posts.distinct("nonexistentField"), []);

  // ---- updateOne ----
  await db.posts.insertOne({ title: "Update Me", category: "UpdateA", tags: ["draft"], views: 1 });

  const updated = await db.posts.updateOne(
    { category: "UpdateA" },
    { $set: { title: "Updated" }, $inc: { views: 4 }, $push: { tags: "reviewed" } }
  );
  assert.deepStrictEqual(updated, { matched: true, modified: true, upsertedId: null });
  const afterUpdate = await db.posts.findOne({ category: "UpdateA" });
  assert.strictEqual(afterUpdate.title, "Updated");
  assert.strictEqual(afterUpdate.views, 5);
  assert.deepStrictEqual(afterUpdate.tags, ["draft", "reviewed"]);

  const noOp = await db.posts.updateOne({ category: "UpdateA" }, { $set: { title: "Updated" } });
  assert.deepStrictEqual(noOp, { matched: true, modified: false, upsertedId: null });

  const noMatch = await db.posts.updateOne({ category: "Nonexistent" }, { $set: { title: "X" } });
  assert.deepStrictEqual(noMatch, { matched: false, modified: false, upsertedId: null });

  const upserted = await db.posts.updateOne(
    { category: "UpdateB" },
    { $set: { title: "Brand New" }, $inc: { views: 1 } },
    { upsert: true }
  );
  assert.strictEqual(upserted.matched, false);
  assert.ok(upserted.upsertedId, "upsert must report the new document's id");
  const upsertedDoc = await db.posts.get(upserted.upsertedId);
  assert.strictEqual(upsertedDoc.category, "UpdateB", "upsert must seed the equality field from the filter");
  assert.strictEqual(upsertedDoc.title, "Brand New");
  assert.strictEqual(upsertedDoc.views, 1);

  // ---- $near (geospatial) ----
  const point = (lng, lat) => ({ type: "Point", coordinates: [lng, lat] });
  await db.posts.insertOne({ title: "Baghdad Post", category: "Geo", location: point(44.4009, 33.3152) });
  await db.posts.insertOne({ title: "Erbil Post", category: "Geo", location: point(44.0086, 36.1911) });
  await db.posts.insertOne({ title: "Basra Post", category: "Geo", location: point(47.8078, 30.5085) });

  const near400km = await db.posts.find({
    location: { $near: { $geometry: point(44.4009, 33.3152), $maxDistance: 400000 } },
  });
  assert.strictEqual(near400km.length, 2, "Baghdad and Erbil are within 400km of Baghdad; Basra is not");

  // ---- change feed (poll-based, not a push stream) ----
  const before = await db.posts.changes();
  const cursorBefore = before.cursor;

  const { _id: changeTestId } = await db.posts.insertOne({ title: "Watch Me", category: "ChangeFeed" });
  await db.posts.updateOne({ _id: changeTestId }, { $set: { title: "Watched" } });
  await db.posts.deleteOne(changeTestId);

  const after = await db.posts.changes(cursorBefore);
  assert.ok(after.cursor > cursorBefore, "cursor must advance");
  const ops = after.events.filter((e) => e.id === changeTestId).map((e) => e.operation);
  assert.deepStrictEqual(ops, ["insert", "replace", "delete"], "insert/updateOne/delete must each produce one event, in order");
  const deleteEvent = after.events.find((e) => e.id === changeTestId && e.operation === "delete");
  assert.strictEqual(deleteEvent.document, null, "a delete event carries no document");

  await db.dropCollection("posts");

  // ---- cleanup ----
  await db.dropCollection("users");
  cols = await db.listCollections();
  assert.strictEqual(cols.length, 0);

  await client.dropDatabase(DB_NAME);
  assert.ok(!(await client.listDatabases()).includes(DB_NAME), "dropped database must not be listed");

  console.log("All NemaJS live tests passed.");
}

main().catch((e) => {
  console.error("NemaJS live test FAILED:", e);
  process.exitCode = 1;
});
