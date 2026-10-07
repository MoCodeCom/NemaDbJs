// Run with: node examples/basic.js
// Requires a NemaDb gateway running at http://127.0.0.1:8070.

const { NemaClient, NemaError } = require("../dist/index.js");

async function main() {
  const client = new NemaClient({ url: "http://127.0.0.1:8070" });

  if (!(await client.health())) {
    console.error("NemaDb gateway is not reachable — start it with:");
    console.error("  cargo run -p gateway -- --data ./data_gateway --addr 127.0.0.1:8070");
    process.exit(1);
  }

  // Fresh database every run, so this example is repeatable rather
  // than accumulating data (and unique-index conflicts) across runs.
  const dbName = "example_shop";
  if ((await client.listDatabases()).includes(dbName)) {
    await client.dropDatabase(dbName);
  }
  await client.createDatabase(dbName);
  const db = client.db(dbName);
  const products = db.collection("products");

  const { _id } = await products.insert({ name: "Widget", price: 9.99 });
  console.log("inserted:", _id);

  console.log("fetched:", await products.get(_id));

  await products.insert({ name: "Gadget", price: 19.99 });
  console.log("expensive items:", await products.find({ price: { $gte: 15 } }));

  await products.createIndex("name", { unique: true });
  try {
    await products.insert({ name: "Widget", price: 1 });
  } catch (e) {
    if (e instanceof NemaError && e.status === 409) {
      console.log("duplicate name correctly rejected:", e.message);
    } else {
      throw e;
    }
  }

  const [avg] = await products.aggregate([{ $group: { _id: null, avgPrice: { $avg: "$price" } } }]);
  console.log("average price:", avg.avgPrice);

  await products.insert({ name: "Multi-tool", price: 24.99, tags: ["tool", "outdoor"] });
  console.log("products with 2 tags:", await products.find({ tags: { $size: 2 } }));
  console.log(
    "products with a tool tag:",
    await products.find({ tags: { $elemMatch: { $eq: "tool" } } })
  );

  // findOneAndReplace/findOneAndDelete do the filter-match-then-write
  // atomically under the gateway's write lock, unlike a client-side
  // find() + replace()/delete() by id.
  const previous = await products.findOneAndReplace(
    { name: "Gadget" },
    { name: "Gadget", price: 17.99 }
  );
  console.log("price before the sale:", previous.price);

  const removed = await products.findOneAndDelete({ name: "Multi-tool" });
  console.log("removed:", removed.name);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
