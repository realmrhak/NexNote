const mongoose = require("mongoose");
const dns      = require("dns");
const logger   = require("../utils/logger");

// ─── Custom DNS resolvers (Google + Cloudflare) ──────────────────────────────
const googleDns    = new dns.Resolver(); googleDns.setServers(["8.8.8.8", "8.8.4.4"]);
const cloudflareDns = new dns.Resolver(); cloudflareDns.setServers(["1.1.1.1", "1.0.0.1"]);

function resolveSrv(hostname) {
  return new Promise((resolve, reject) => {
    googleDns.resolveSrv(hostname, (err, addresses) => {
      if (!err && addresses.length) return resolve(addresses);
      logger.warn(`Google DNS SRV failed for ${hostname}, trying Cloudflare…`);
      cloudflareDns.resolveSrv(hostname, (err2, addresses2) => {
        if (!err2 && addresses2.length) return resolve(addresses2);
        reject(new Error(`SRV lookup failed for ${hostname}: ${err?.message || err2?.message}`));
      });
    });
  });
}

function resolveTxt(hostname) {
  return new Promise((resolve) => {
    googleDns.resolveTxt(hostname, (err, records) => {
      if (!err && records.length) return resolve(records);
      cloudflareDns.resolveTxt(hostname, (err2, records2) => {
        if (!err2 && records2.length) return resolve(records2);
        resolve([]); // TXT is optional, don't fail
      });
    });
  });
}

/**
 * Convert mongodb+srv:// URI to standard mongodb:// URI
 * by manually resolving SRV and TXT records using Google/Cloudflare DNS.
 */
async function convertSrvToStandard(uri) {
  // Parse: mongodb+srv://user:pass@cluster.zxf4i8b.mongodb.net/dbname?params
  const match = uri.match(/^mongodb\+srv:\/\/([^@]+)@([^\/]+)\/?([^?]*)\??(.*)$/);
  if (!match) return uri; // Not SRV format, return as-is

  const credentials = match[1];
  const clusterHost = match[2];
  const dbName      = match[3] || "nexnote";
  const extraParams = match[4];

  const srvHostname = `_mongodb._tcp.${clusterHost}`;

  logger.info(`Resolving SRV: ${srvHostname} via Google/Cloudflare DNS…`);

  // Resolve SRV → get host:port list
  const srvRecords = await resolveSrv(srvHostname);
  const hosts = srvRecords
    .sort((a, b) => a.priority - b.priority)
    .map((r) => `${r.name}:${r.port}`)
    .join(",");

  // Resolve TXT → get authSource, replicaSet, etc.
  const txtRecords = await resolveTxt(clusterHost);
  let txtParams = "";
  if (txtRecords.length && txtRecords[0].length) {
    txtParams = txtRecords.map((r) => r.join("")).join("&");
  }

  // Build standard connection string
  const params = ["ssl=true"];
  if (txtParams) params.push(txtParams);
  if (extraParams) params.push(extraParams);

  const standardUri = `mongodb://${credentials}@${hosts}/${dbName}?${params.join("&")}`;
  logger.info(`Converted SRV → Standard: ${hosts}`);

  return standardUri;
}

// ─── Main connection function ─────────────────────────────────────────────────
async function connectDB() {
  let uri = process.env.MONGODB_URI;
  if (!uri) { logger.error("MONGODB_URI is not defined."); process.exit(1); }

  // If SRV format, try converting to standard using custom DNS
  if (uri.startsWith("mongodb+srv://")) {
    try {
      logger.info("Detected mongodb+srv:// — resolving via Google/Cloudflare DNS…");
      uri = await convertSrvToStandard(uri);
      logger.info("SRV resolved successfully. Using standard connection string.");
    } catch (err) {
      logger.warn(`SRV resolution failed: ${err.message}`);
      logger.info("Falling back to direct SRV connection (may fail on some ISPs)…");
      // Keep original URI and try anyway
      uri = process.env.MONGODB_URI;
    }
  }

  const options = { maxPoolSize: 10, serverSelectionTimeoutMS: 10000, socketTimeoutMS: 45000 };

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const conn = await mongoose.connect(uri, options);
      logger.info(`MongoDB connected: ${conn.connection.host}`);
      return; // Success!
    } catch (err) {
      logger.error(`MongoDB attempt ${attempt}/${maxRetries} failed: ${err.message}`);
      if (attempt < maxRetries) {
        const wait = attempt * 5000;
        logger.info(`Retrying in ${wait / 1000}s…`);
        await new Promise((r) => setTimeout(r, wait));
      } else {
        logger.error("All MongoDB connection attempts failed.");
        process.exit(1);
      }
    }
  }
}

mongoose.set("strictQuery", true);
mongoose.connection.on("disconnected", () => logger.warn("MongoDB disconnected."));
mongoose.connection.on("reconnected",  () => logger.info("MongoDB reconnected."));
mongoose.connection.on("error",        (e) => logger.error(`MongoDB error: ${e.message}`));

// ─── BUG 1 FIX: ensureNotesIndexes — bulletproof shareToken index repair ──────
//
// ROOT CAUSE
// ==========
// The Note schema originally declared `shareToken` with `{ unique: true }`
// (no sparse, no partial filter). That created a plain unique index named
// `shareToken_1` in MongoDB. Because notes that are NOT shared still write
// `shareToken: null` into the document (the schema default), EVERY non-shared
// note ended up in the index with key `shareToken: null`. The second non-shared
// note then collided with the first → E11000 duplicate key error → note
// creation was completely broken.
//
// WHY THE PREVIOUS FIX WAS NOT ENOUGH
// ====================================
// The schema was updated to use `partialFilterExpression: { shareToken:
// { $type: "string" } }` (which excludes null/missing values from the index).
// However, MongoDB does NOT silently replace an existing index when a schema
// changes — the old `shareToken_1` index (without the partial filter) stayed
// in place and kept rejecting inserts. Mongoose's `syncIndexes()` only drops
// indexes whose DEFINITION differs from the schema, and even then it can be
// flaky when the index name collides. The previous auto-fix ran on the
// `"open"` event, which fires asynchronously AFTER `mongoose.connect()`
// resolves — meaning `app.listen()` could start serving requests BEFORE the
// index was repaired, so the first few POST /api/notes calls still hit the
// bad index.
//
// THIS FIX
// ========
// 1. Exposed as an async function that server.js `await`s BEFORE app.listen().
// 2. Drops EVERY index whose key includes `shareToken` (sparse, non-sparse,
//    partial-filter — anything), so there is no name collision when we
//    recreate the correct one.
// 3. Creates the correct partial-filter unique index explicitly via the raw
//    MongoDB driver (not relying on syncIndexes), so we control the exact
//    options.
// 4. Cleans up existing documents that have `shareToken: null` stored in
//    the document by `$unset`-ing the field. This is not strictly required
//    for the partial-filter index (null values are excluded), but it keeps
//    the collection clean and prevents any future regression if someone
//    accidentally removes the partial filter.
// 5. Logs every step so the fix is auditable in the server logs.
async function ensureNotesIndexes() {
  try {
    const collection = mongoose.connection.db.collection("notes");

    // ─── Step 1: list & drop all existing shareToken indexes ────────────────
    const indexes = await collection.indexes();
    const shareTokenIndexes = indexes.filter(
      (idx) => idx.key && idx.key.shareToken !== undefined
    );

    if (shareTokenIndexes.length === 0) {
      logger.info("Index check: no existing shareToken index — will be created from schema.");
    } else {
      for (const idx of shareTokenIndexes) {
        logger.info(
          `Index check: dropping legacy shareToken index "${idx.name}" ` +
          `(unique: ${!!idx.unique}, sparse: ${!!idx.sparse}, partial: ${!!idx.partialFilterExpression})…`
        );
        try {
          await collection.dropIndex(idx.name);
          logger.info(`Index check: dropped "${idx.name}".`);
        } catch (dropErr) {
          // If the index doesn't exist (race condition), ignore the error
          if (dropErr.code === 27 || dropErr.codeName === "IndexNotFound") {
            logger.info(`Index check: "${idx.name}" already gone.`);
          } else {
            logger.warn(`Index check: could not drop "${idx.name}": ${dropErr.message}`);
          }
        }
      }
    }

    // ─── Step 2: explicitly create the correct partial-filter unique index ──
    // partialFilterExpression: { shareToken: { $type: "string" } } means the
    // index only includes documents where shareToken is a string. null and
    // missing values are both excluded → multiple non-shared notes no longer
    // collide.
    try {
      await collection.createIndex(
        { shareToken: 1 },
        {
          unique: true,
          name: "shareToken_1",
          partialFilterExpression: { shareToken: { $type: "string" } },
        }
      );
      logger.info("Index check: created partial-filter unique index on shareToken ✓");
    } catch (createErr) {
      // If the index already exists with the right options, MongoDB returns
      // IndexOptionsConflict (code 85) — that's fine, the index is correct.
      if (createErr.code === 85 || createErr.codeName === "IndexOptionsConflict") {
        logger.info("Index check: shareToken index already exists with correct options ✓");
      } else {
        logger.warn(`Index check: could not create shareToken index: ${createErr.message}`);
      }
    }

    // ─── Step 3: clean up documents with shareToken: null ───────────────────
    // Old code wrote `shareToken: null` into every non-shared note. The
    // partial-filter index excludes these, but we unset the field anyway so
    // the documents are clean and any future schema regression won't bring
    // the E11000 error back.
    try {
      const result = await collection.updateMany(
        { shareToken: null },
        { $unset: { shareToken: "" } }
      );
      if (result.modifiedCount > 0) {
        logger.info(`Index check: cleaned up ${result.modifiedCount} note(s) with shareToken: null.`);
      }
    } catch (cleanupErr) {
      logger.warn(`Index check: shareToken cleanup failed (non-fatal): ${cleanupErr.message}`);
    }

    // ─── Step 4: sync remaining Mongoose indexes (non-shareToken) ───────────
    try {
      const Note = require("../models/Note");
      await Note.syncIndexes();
      logger.info("Index check: Note indexes synced successfully.");
    } catch (syncErr) {
      logger.warn(`Index check: syncIndexes failed (non-fatal): ${syncErr.message}`);
    }
  } catch (err) {
    logger.warn(`Index check: shareToken index repair skipped: ${err.message}`);
  }
}

// Also run the check on reconnection (e.g., after a network blip)
mongoose.connection.on("open", () => {
  ensureNotesIndexes().catch((err) =>
    logger.warn(`Index check on open failed: ${err.message}`)
  );
});

module.exports = connectDB;
module.exports.ensureNotesIndexes = ensureNotesIndexes;
