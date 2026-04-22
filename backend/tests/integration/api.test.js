/**
 * @file api.test.js
 * @description Supertest integration tests for POST /api/cards/recommend.
 * Starts the real Express app (no mocks) to verify the full request/response cycle.
 */

const request = require('supertest');
const app = require('../../app');

/** Fully valid request body that should always return 200. */
const VALID_PAYLOAD = {
  profile: {
    creditScore: 750,
    accountsOpened24: 2,
    isStudent: false,
    preferredEcosystem: 'Chase',
    travelFrequency: 'Often',
    rewardPreference: 'Points/Miles',
  },
  spending: {
    groceries: 400,
    dining: 200,
    travel: 150,
    other: 100,
  },
};

// ---------------------------------------------------------------------------
// Success path
// ---------------------------------------------------------------------------

describe('POST /api/cards/recommend — valid payload', () => {
  test('returns 200 with scored, bestByCategory, and bestOverall', async () => {
    const res = await request(app).post('/api/cards/recommend').send(VALID_PAYLOAD);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('bestOverall');
    expect(res.body).toHaveProperty('bestByCategory');
    expect(res.body).toHaveProperty('scored');
  });

  test('bestOverall is an array of up to 3 cards', async () => {
    const res = await request(app).post('/api/cards/recommend').send(VALID_PAYLOAD);

    expect(Array.isArray(res.body.bestOverall)).toBe(true);
    expect(res.body.bestOverall.length).toBeGreaterThan(0);
    expect(res.body.bestOverall.length).toBeLessThanOrEqual(3);
  });

  test('each card in bestOverall has name and annual estimate', async () => {
    const res = await request(app).post('/api/cards/recommend').send(VALID_PAYLOAD);

    for (const card of res.body.bestOverall) {
      expect(card).toHaveProperty('name');
      expect(card.estimates).toHaveProperty('annual');
    }
  });

  test('bestByCategory has an entry for each spending category sent', async () => {
    const res = await request(app).post('/api/cards/recommend').send(VALID_PAYLOAD);

    for (const cat of Object.keys(VALID_PAYLOAD.spending)) {
      expect(res.body.bestByCategory).toHaveProperty(cat);
    }
  });

  test('accepts optional fields missing from profile', async () => {
    const payload = {
      profile: { creditScore: 700, accountsOpened24: 1 },
      spending: VALID_PAYLOAD.spending,
    };
    const res = await request(app).post('/api/cards/recommend').send(payload);
    expect(res.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Validation errors — invalid values
// ---------------------------------------------------------------------------

describe('POST /api/cards/recommend — invalid creditScore', () => {
  test('returns 400 with VALIDATION_ERROR when creditScore is above 850', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      profile: { ...VALID_PAYLOAD.profile, creditScore: 900 },
    };
    const res = await request(app).post('/api/cards/recommend').send(payload);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(res.body.fields['profile.creditScore']).toBeDefined();
  });

  test('returns 400 with VALIDATION_ERROR when creditScore is below 300', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      profile: { ...VALID_PAYLOAD.profile, creditScore: 100 },
    };
    const res = await request(app).post('/api/cards/recommend').send(payload);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(res.body.fields['profile.creditScore']).toBeDefined();
  });

  test('returns 400 when creditScore is a string', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      profile: { ...VALID_PAYLOAD.profile, creditScore: 'great' },
    };
    const res = await request(app).post('/api/cards/recommend').send(payload);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// Validation errors — missing required fields
// ---------------------------------------------------------------------------

describe('POST /api/cards/recommend — missing spending fields', () => {
  test('returns 400 when spending.groceries is missing', async () => {
    const { groceries, ...spendingWithout } = VALID_PAYLOAD.spending;
    const payload = { ...VALID_PAYLOAD, spending: spendingWithout };
    const res = await request(app).post('/api/cards/recommend').send(payload);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(res.body.fields['spending.groceries']).toBeDefined();
  });

  test('returns 400 when entire spending object is missing', async () => {
    const { spending, ...payloadWithout } = VALID_PAYLOAD;
    const res = await request(app).post('/api/cards/recommend').send(payloadWithout);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(res.body.fields['spending']).toBeDefined();
  });

  test('returns 400 when entire profile object is missing', async () => {
    const { profile, ...payloadWithout } = VALID_PAYLOAD;
    const res = await request(app).post('/api/cards/recommend').send(payloadWithout);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(res.body.fields['profile']).toBeDefined();
  });

  test('returns 400 when body is empty', async () => {
    const res = await request(app).post('/api/cards/recommend').send({});

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  test('reports multiple missing fields at once', async () => {
    const payload = {
      profile: { creditScore: 750 }, // missing accountsOpened24
      spending: { groceries: 400 },  // missing dining, travel, other
    };
    const res = await request(app).post('/api/cards/recommend').send(payload);

    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.body.fields).length).toBeGreaterThan(1);
  });
});
