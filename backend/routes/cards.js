/**
 * @file cards.js
 * @description Express routes for the cards resource.
 * Handles GET /api/cards (list), GET /api/cards/:id (detail),
 * and POST /api/cards/recommend (recommendations).
 */

const express = require('express');
const router  = express.Router();

const dataStore            = require('../services/dataStore');
const { recommendCards }   = require('../services/rewardsService');
const { validateRecommendRequest } = require('../middleware/validateRecommendRequest');

// GET /api/cards — return all cards
router.get('/', (req, res) => {
  res.json(dataStore.getAllCards());
});

// GET /api/cards/:id — return a specific card by ID
router.get('/:id', (req, res) => {
  const card = dataStore.getCardById(req.params.id);
  if (!card) return res.status(404).json({ error: 'Card not found' });
  res.json(card);
});

// POST /api/cards/recommend — compute and return recommendations
router.post('/recommend', validateRecommendRequest, (req, res) => {
  try {
    const startMs = Date.now();
    const { profile, spending, ownedCards = [] } = req.body;

    const cards  = dataStore.getAllCards();
    const result = recommendCards(cards, profile, spending, ownedCards);

    // Fire-and-forget: log the recommendation without blocking the response
    dataStore.logRecommendation({
      sessionId:  req.headers['x-session-id'] || null,
      profile,
      spending,
      results:    result,
      durationMs: Date.now() - startMs,
    });

    res.json(result);
  } catch (err) {
    console.error('Recommend API error:', err);
    res.status(500).json({ error: 'Recommendation server error' });
  }
});

module.exports = router;
