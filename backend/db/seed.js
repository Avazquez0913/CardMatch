/**
 * @file seed.js
 * @description Creates the SQLite database and populates the cards table from
 * data/cards.json. Safe to run multiple times — skips rows that already exist.
 *
 * Usage: node backend/db/seed.js
 */

require('dotenv').config();
const path = require('path');
const fs   = require('fs');
const Database = require('better-sqlite3');

const DB_PATH    = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'cardmatch.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const CARDS_PATH  = path.join(__dirname, '..', '..', 'data', 'cards.json');

/**
 * Opens (or creates) the SQLite database at DB_PATH, applies the schema,
 * and inserts every card from cards.json that is not already present.
 *
 * @returns {void}
 */
function seed() {
  const db = new Database(DB_PATH);

  // Apply schema (CREATE TABLE IF NOT EXISTS — idempotent)
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);

  // Load source-of-truth card catalog
  const cards = JSON.parse(fs.readFileSync(CARDS_PATH, 'utf8'));

  const insert = db.prepare(`
    INSERT OR IGNORE INTO cards
      (id, name, issuer, annual_fee, min_credit_score, reward_tiers, eligibility_rules)
    VALUES
      (@id, @name, @issuer, @annual_fee, @min_credit_score, @reward_tiers, @eligibility_rules)
  `);

  const seedAll = db.transaction((cardList) => {
    for (const card of cardList) {
      insert.run({
        id:               card.id,
        name:             card.name,
        issuer:           card.issuer || card.ecosystem || '',
        annual_fee:       card.annualFee || 0,
        min_credit_score: card.minCreditScore || 0,
        reward_tiers:     JSON.stringify(card.rewards || {}),
        eligibility_rules: JSON.stringify({
          level:               card.level,
          secured:             card.secured,
          studentFriendly:     card.studentFriendly,
          rotatingCategories:  card.rotatingCategories,
          unlockTransferPartners: card.unlockTransferPartners,
          pointValueCents:     card.pointValueCents,
          ecosystem:           card.ecosystem,
        }),
      });
    }
  });

  seedAll(cards);

  const count = db.prepare('SELECT COUNT(*) AS n FROM cards').get();
  console.log(`Seed complete. Cards in database: ${count.n}`);

  db.close();
}

seed();
