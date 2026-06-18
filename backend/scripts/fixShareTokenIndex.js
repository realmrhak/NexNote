/**
 * Migration script: Fix shareToken index
 *
 * ROOT CAUSE
 * ==========
 * The Note model's shareToken field previously used a plain `{ unique: true }`
 * index (no sparse, no partial filter). Combined with the pre-save hook that
 * wrote `shareToken = null` for every non-shared note, every saved note ended
 * up in the index with key `shareToken: null`. The second non-shared note
 * then collided with the first → E11000 duplicate key error → note creation
 * was completely broken.
 *
 * THE FIX
 * =======
 * 1. Drop ALL shareToken indexes (sparse, non-sparse, partial-filter — anything)
 *    for a clean state.
 * 2. Create the correct partial-filter unique index:
 *      { shareToken: 1 } with
 *      partialFilterExpression: { shareToken: { $type: "string" } }
 *    This only indexes documents where shareToken is a string, so null and
 *    missing values are both excluded from the unique constraint.
 * 3. Clean up existing documents that have `shareToken: null` stored in the
 *    document by `$unset`-ing the field. Not strictly required for the
 *    partial-filter index (null values are excluded), but keeps the collection
 *    clean and prevents any future regression.
 *
 * NOTE
 * ====
 * The backend now also runs this fix automatically on startup (see
 * backend/config/db.js → ensureNotesIndexes), so running this script manually
 * is only necessary if you want to repair the index without restarting the
 * server.
 *
 * Run: node scripts/fixShareTokenIndex.js
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");

async function fixShareTokenIndex() {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/nexnote";
  console.log("Connecting to MongoDB…");
  await mongoose.connect(uri);
  console.log("Connected.");

  const db = mongoose.connection.db;
  const collection = db.collection("notes");

  // ─── Step 1: List existing indexes ────────────────────────────────────────
  const indexes = await collection.indexes();
  console.log("\nCurrent indexes on 'notes' collection:");
  indexes.forEach(idx =>
    console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)} (unique: ${!!idx.unique}, sparse: ${!!idx.sparse}, partial: ${!!idx.partialFilterExpression})`)
  );

  // ─── Step 2: Drop ALL shareToken indexes ──────────────────────────────────
  const shareTokenIndexes = indexes.filter(idx => idx.key && idx.key.shareToken !== undefined);
  if (shareTokenIndexes.length === 0) {
    console.log("\nNo shareToken index found. It will be created fresh.");
  } else {
    for (const idx of shareTokenIndexes) {
      console.log(`\nDropping shareToken index: ${idx.name} (sparse: ${!!idx.sparse}, partial: ${!!idx.partialFilterExpression})`);
      try {
        await collection.dropIndex(idx.name);
        console.log(`  ✓ Dropped "${idx.name}".`);
      } catch (err) {
        if (err.code === 27 || err.codeName === "IndexNotFound") {
          console.log(`  · "${idx.name}" already gone.`);
        } else {
          console.error(`  ✗ Failed to drop "${idx.name}": ${err.message}`);
        }
      }
    }
  }

  // ─── Step 3: Create the correct partial-filter unique index ───────────────
  // partialFilterExpression: { shareToken: { $type: "string" } } excludes
  // null AND missing values from the unique constraint.
  try {
    await collection.createIndex(
      { shareToken: 1 },
      {
        unique: true,
        name: "shareToken_1",
        partialFilterExpression: { shareToken: { $type: "string" } },
      }
    );
    console.log("\n✓ Created partial-filter unique shareToken index.");
  } catch (err) {
    if (err.code === 85 || err.codeName === "IndexOptionsConflict") {
      console.log("\n✓ shareToken index already exists with correct options.");
    } else {
      console.error(`\n✗ Failed to create shareToken index: ${err.message}`);
    }
  }

  // ─── Step 4: Clean up documents with shareToken: null ─────────────────────
  try {
    const result = await collection.updateMany(
      { shareToken: null },
      { $unset: { shareToken: "" } }
    );
    if (result.modifiedCount > 0) {
      console.log(`✓ Cleaned up ${result.modifiedCount} note(s) with shareToken: null.`);
    } else {
      console.log("· No notes needed shareToken cleanup.");
    }
  } catch (err) {
    console.error(`✗ shareToken cleanup failed (non-fatal): ${err.message}`);
  }

  // ─── Step 5: Verify final state ───────────────────────────────────────────
  const finalIndexes = await collection.indexes();
  const shareTokenFinal = finalIndexes.find(idx => idx.key && idx.key.shareToken !== undefined);
  if (shareTokenFinal) {
    console.log(`\nFinal shareToken index: ${shareTokenFinal.name}`);
    console.log(`  unique: ${!!shareTokenFinal.unique}`);
    console.log(`  partialFilterExpression: ${JSON.stringify(shareTokenFinal.partialFilterExpression)}`);
    if (shareTokenFinal.partialFilterExpression && shareTokenFinal.partialFilterExpression.shareToken) {
      console.log("✅ Index has partialFilterExpression — E11000 errors for null shareToken values will NOT occur.");
    } else if (shareTokenFinal.sparse) {
      console.log("⚠️  Index is sparse (NOT partial-filter) — may still collide on null values. Re-run this script.");
    } else {
      console.log("❌ WARNING: Index is NOT partial-filter — E11000 errors may still occur!");
    }
  }

  await mongoose.disconnect();
  console.log("\nDone.");
}

fixShareTokenIndex().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
