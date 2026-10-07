// Run with: node examples/mongo-style.js
// Requires a NemaDb gateway running at http://127.0.0.1:8070.
//
// Same package as basic.js — this just shows the MongoDB-familiar
// syntax (db.posts.insertOne(...), db.posts.find({...})) instead of
// the explicit db.collection("posts").insert(...) style. Both work
// everywhere; pick whichever reads better to you.

const { NemaClient } = require("../dist/index.js");

async function main() {
  const client = new NemaClient({ url: "http://127.0.0.1:8070" });

  if (!(await client.health())) {
    console.error("NemaDb gateway is not reachable — start it with:");
    console.error("  cargo run -p gateway -- --data ./data_gateway --addr 127.0.0.1:8070");
    process.exit(1);
  }

  // Fresh database every run, so this example is repeatable.
  const dbName = "example_blog";
  if ((await client.listDatabases()).includes(dbName)) {
    await client.dropDatabase(dbName);
  }
  await client.createDatabase(dbName);
  const db = client.db(dbName);

  // db.posts works without ever calling db.createCollection("posts") or
  // db.collection("posts") first — the same implicit-creation-on-insert
  // behavior NemaDb itself has, just spelled the way mongosh spells it.
  await db.posts.insertOne({ title: "Hello, NemaDb", category: "News" });
  await db.posts.insertOne({ title: "Season Recap", category: "Sports" });
  await db.posts.insertOne({ title: "Budget Update", category: "News" });

  console.log("all posts:", await db.posts.find());
  console.log("news only:", await db.posts.find({ category: "News" }));

  const firstNews = await db.posts.findOne({ category: "News" });
  console.log("first news post:", firstNews);

  await db.posts.replaceOne(firstNews._id, { title: "Hello, NemaDb (updated)", category: "News" });
  console.log("after replaceOne:", await db.posts.get(firstNews._id));

  await db.posts.deleteOne(firstNews._id);
  console.log("remaining posts:", await db.posts.find());

  // findOneAndReplace/findOneAndDelete take a filter instead of an id,
  // and do the match-then-write atomically under the gateway's write lock.
  await db.posts.insertOne({ title: "Draft", category: "Drafts", tags: ["wip"] });
  console.log("posts tagged wip:", await db.posts.find({ tags: { $elemMatch: { $eq: "wip" } } }));

  const publishedFrom = await db.posts.findOneAndReplace(
    { category: "Drafts" },
    { title: "Draft (published)", category: "News" }
  );
  console.log("was a draft called:", publishedFrom.title);

  const gone = await db.posts.findOneAndDelete({ category: "Sports" });
  console.log("removed:", gone.title);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
