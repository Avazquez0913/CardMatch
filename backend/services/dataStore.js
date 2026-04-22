/**
 * @file dataStore.js
 * @description Data access layer for CardMatch.
 * Reads cards from SQLite and logs recommendations to the database.
 * Falls back to cards.json seed if the database has not been initialised yet.
 */

require('dotenv').config();
const path     = require('path');
const fs       = require('fs');
const Database = require('better-sqlite3');

const DB_PATH     = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'cardmatch.db');
const SCHEMA_PATH = path.join(__dirname, '..', 'db', 'schema.sql');
const SEED_PATH   = path.join(__dirname, '..', 'db', 'seed.js');

/** Algo version constant — increment when scoring logic changes. */
const ALGO_VERSION = 'v1.0';

/**
 * Opens (or creates) the SQLite database, applies the schema, and seeds it
 * from cards.json if the cards table is empty.
 *
 * @returns {import('better-sqlite3').Database}
 */
function openDb() {
  const db = new Database(DB_PATH);

  // Apply schema idempotently
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);

  // Auto-seed if table is empty (first run)
  const count = db.prepare('SELECT COUNT(*) AS n FROM cards').get();
  if (count.n === 0) {
    require(SEED_PATH);
  }

  return db;
}

// Single shared connection — opened once per process.
const db = openDb();

/**
 * Reconstructs a full card object from a SQLite row.
 * reward_tiers and eligibility_rules are stored as JSON strings.
 *
 * @param {object} row - A row from the cards table.
 * @returns {object} Card object matching the original cards.json shape.
 */
function rowToCard(row) {
  const eligibility = JSON.parse(row.eligibility_rules || '{}');
  return {
    id:                    row.id,
    name:                  row.name,
    issuer:                row.issuer,
    ecosystem:             eligibility.ecosystem || row.issuer,
    level:                 eligibility.level,
    secured:               eligibility.secured,
    studentFriendly:       eligibility.studentFriendly,
    rotatingCategories:    eligibility.rotatingCategories,
    unlockTransferPartners: eligibility.unlockTransferPartners,
    pointValueCents:       eligibility.pointValueCents,
    annualFee:             row.annual_fee,
    minCreditScore:        row.min_credit_score,
    rewards:               JSON.parse(row.reward_tiers || '{}'),
  };
}

/**
 * Returns all cards from the database.
 *
 * @returns {object[]} Array of card objects.
 */
function getAllCards() {
  const rows = db.prepare('SELECT * FROM cards ORDER BY id').all();
  return rows.map(rowToCard);
}

/**
 * Returns a single card by its numeric ID, or null if not found.
 *
 * @param {number|string} id - The card ID.
 * @returns {object|null} Card object or null.
 */
function getCardById(id) {
  const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(Number(id));
  return row ? rowToCard(row) : null;
}

/**
 * Logs a completed recommendation to the recommendation_logs table.
 * Runs synchronously but is called in a fire-and-forget pattern by the route —
 * errors are swallowed so they never affect the HTTP response.
 *
 * @param {object} params
 * @param {string} params.sessionId   - Opaque session identifier.
 * @param {object} params.profile     - User profile that was submitted.
 * @param {object} params.spending    - Spending breakdown that was submitted.
 * @param {object} params.results     - The recommendation result returned to the client.
 * @param {number} params.durationMs  - Wall-clock time for the recommendation in ms.
 * @returns {void}
 */
function logRecommendation({ sessionId, profile, spending, results, durationMs }) {
  try {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    db.prepare(`
      INSERT INTO recommendation_logs
        (id, session_id, profile, spending, results, algo_version, duration_ms)
      VALUES
        (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      sessionId || null,
      JSON.stringify(profile),
      JSON.stringify(spending),
      JSON.stringify(results),
      ALGO_VERSION,
      durationMs || null,
    );
  } catch (_err) {
    // Fire-and-forget: logging failure must never affect the API response
  }
}

module.exports = { getAllCards, getCardById, logRecommendation };
