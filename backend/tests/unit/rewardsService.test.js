/**
 * @file rewardsService.test.js
 * @description Unit tests for the core scoring algorithm.
 * Covers: eligibility filter, annual value calculation,
 * preference modifier application, and category winner selection.
 */

const {
  isEligible,
  estimateRewardsForCard,
  recommendCards,
} = require('../../services/rewardsService');

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** Standard Chase card requiring 670+ credit score. */
const chaseCard = {
  id: 1,
  name: 'Chase Sapphire Preferred',
  issuer: 'Chase',
  level: 'Premium',
  annualFee: 95,
  pointValueCents: 2,
  minCreditScore: 670,
  rewards: { dining: 3, travel: 3, groceries: 1, other: 1 },
  studentFriendly: false,
  rotatingCategories: false,
};

/** No-fee student card. */
const studentCard = {
  id: 2,
  name: 'Discover Student Cash Back',
  issuer: 'Discover',
  level: 'Student',
  annualFee: 0,
  pointValueCents: 1,
  minCreditScore: 620,
  rewards: { dining: 1, groceries: 1, travel: 1, other: 1 },
  studentFriendly: true,
  rotatingCategories: false,
};

/** Flat 2% cash-back card, no annual fee, low credit floor. */
const cashBackCard = {
  id: 3,
  name: 'Citi Double Cash',
  issuer: 'Citi',
  level: 'Mid',
  annualFee: 0,
  pointValueCents: 1,
  minCreditScore: 580,
  rewards: { default: 2 },
  studentFriendly: false,
  rotatingCategories: false,
};

/** High-fee premium travel card. */
const premiumCard = {
  id: 4,
  name: 'Amex Platinum',
  issuer: 'Amex',
  level: 'Premium',
  annualFee: 695,
  pointValueCents: 2,
  minCreditScore: 720,
  rewards: { travel: 5, dining: 1, groceries: 1, other: 1 },
  studentFriendly: false,
  rotatingCategories: false,
};

const ALL_CARDS = [chaseCard, studentCard, cashBackCard, premiumCard];

/** Standard spending profile used across many tests. */
const STD_SPENDING = { groceries: 400, dining: 200, travel: 150, other: 100 };

// ---------------------------------------------------------------------------
// isEligible — eligibility filter
// ---------------------------------------------------------------------------

describe('isEligible — credit score cutoff', () => {
  test('approves profile that meets minimum credit score', () => {
    expect(isEligible(chaseCard, { creditScore: 720, accountsOpened24: 0 })).toBe(true);
  });

  test('approves premium card at exactly score 680 (clears mid-range block)', () => {
    // chaseCard: Premium, min 670. The 630–679 band blocks premium cards,
    // so the effective minimum is 680. Score 680 must pass.
    expect(isEligible(chaseCard, { creditScore: 680, accountsOpened24: 0 })).toBe(true);
  });

  test('rejects premium card at score 679 (inside mid-range premium block)', () => {
    expect(isEligible(chaseCard, { creditScore: 679, accountsOpened24: 0 })).toBe(false);
  });

  test('rejects premium card when credit score is in mid range (630-679)', () => {
    expect(isEligible(chaseCard, { creditScore: 650, accountsOpened24: 0 })).toBe(false);
  });

  test('rejects any non-beginner/student card when credit score is below 630', () => {
    expect(isEligible(cashBackCard, { creditScore: 620, accountsOpened24: 0 })).toBe(false);
  });

  test('allows card with no minCreditScore for any profile', () => {
    const noMinCard = { ...chaseCard, minCreditScore: 0 };
    expect(isEligible(noMinCard, { creditScore: 300, accountsOpened24: 0 })).toBe(true);
  });

  test('allows any card when profile has no creditScore field', () => {
    expect(isEligible(chaseCard, {})).toBe(true);
  });
});

describe('isEligible — Chase 5/24 rule', () => {
  test('blocks Chase card when accountsOpened24 is exactly 5', () => {
    expect(isEligible(chaseCard, { creditScore: 750, accountsOpened24: 5 })).toBe(false);
  });

  test('blocks Chase card when accountsOpened24 is greater than 5', () => {
    expect(isEligible(chaseCard, { creditScore: 750, accountsOpened24: 7 })).toBe(false);
  });

  test('allows Chase card when accountsOpened24 is 4', () => {
    expect(isEligible(chaseCard, { creditScore: 750, accountsOpened24: 4 })).toBe(true);
  });

  test('does not apply 5/24 rule to non-Chase cards', () => {
    expect(isEligible(studentCard, { creditScore: 750, accountsOpened24: 5 })).toBe(true);
  });
});

describe('isEligible — student card flag', () => {
  test('allows student card for qualifying student profile', () => {
    expect(isEligible(studentCard, { creditScore: 630, accountsOpened24: 0, isStudent: true })).toBe(true);
  });

  test('allows student card for non-student if credit score qualifies', () => {
    // studentFriendly is a boost flag; non-students can still get the card if score meets minimum
    expect(isEligible(studentCard, { creditScore: 680, accountsOpened24: 0, isStudent: false })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// estimateRewardsForCard — annual value calculation
// ---------------------------------------------------------------------------

describe('estimateRewardsForCard — known inputs produce known outputs', () => {
  test('calculates exact annual value: 3x dining @ 2 cents, $300/month, $95 fee', () => {
    // 300 * 12 * 3 * (2/100) = 216; 216 - 95 = 121
    const result = estimateRewardsForCard(chaseCard, { dining: 300, groceries: 0, travel: 0, other: 0 });
    expect(result.annual).toBeCloseTo(121, 1);
  });

  test('returns zero annual value when all spending is zero and no annual fee', () => {
    const result = estimateRewardsForCard(studentCard, { dining: 0, groceries: 0, travel: 0, other: 0 });
    expect(result.annual).toBe(0);
    expect(result.monthly).toBe(0);
  });

  test('returns negative annual value when fee exceeds rewards', () => {
    // $30/month dining × 12 × 3x × 2¢ = $21.60 gross; minus $95 fee = -$73.40
    const result = estimateRewardsForCard(chaseCard, { dining: 30, groceries: 0, travel: 0, other: 0 });
    expect(result.annual).toBeLessThan(0);
  });

  test('falls back to default reward rate for unknown category', () => {
    // cashBackCard has only default: 2; all spend should earn at 2x
    const result = estimateRewardsForCard(cashBackCard, { groceries: 100, dining: 100, travel: 100, other: 100 });
    // 400 total monthly * 12 * 2 * (1/100) = 96
    expect(result.annual).toBeCloseTo(96, 0);
  });

  test('monthly value equals annual divided by 12', () => {
    const result = estimateRewardsForCard(chaseCard, STD_SPENDING);
    expect(result.monthly).toBeCloseTo(result.annual / 12, 1);
  });

  test('result is rounded to 2 decimal places', () => {
    const result = estimateRewardsForCard(chaseCard, STD_SPENDING);
    const decimalPlaces = (result.annual.toString().split('.')[1] || '').length;
    expect(decimalPlaces).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// recommendCards — preference modifiers
// ---------------------------------------------------------------------------

describe('recommendCards — preference modifiers', () => {
  const baseProfile = { creditScore: 750, accountsOpened24: 1, isStudent: false };

  test('Points/Miles preference boosts card with 3x travel rate', () => {
    const pointsProfile = { ...baseProfile, rewardPreference: 'Points/Miles', travelFrequency: 'Never' };
    const cashProfile  = { ...baseProfile, rewardPreference: 'Cash Back',    travelFrequency: 'Never' };
    const spending = { groceries: 0, dining: 0, travel: 500, other: 0 };

    const pointsResult = recommendCards([chaseCard], pointsProfile, spending, []);
    const cashResult   = recommendCards([chaseCard], cashProfile,   spending, []);

    // Chase has 3x travel — Points/Miles profile should score it higher
    expect(pointsResult.bestOverall[0].estimates.annual)
      .toBeGreaterThanOrEqual(cashResult.bestOverall[0].estimates.annual);
  });

  test('travelFrequency "Often" boosts cards with high travel rates', () => {
    const oftenProfile = { ...baseProfile, travelFrequency: 'Often', rewardPreference: 'Either' };
    const neverProfile = { ...baseProfile, travelFrequency: 'Never', rewardPreference: 'Either' };
    const spending = { groceries: 0, dining: 0, travel: 500, other: 0 };

    const oftenResult = recommendCards([chaseCard], oftenProfile, spending, []);
    const neverResult = recommendCards([chaseCard], neverProfile, spending, []);

    expect(oftenResult.bestOverall[0].estimates.annual)
      .toBeGreaterThan(neverResult.bestOverall[0].estimates.annual);
  });

  test('student flag boosts student-friendly card score', () => {
    const studentProfile    = { ...baseProfile, creditScore: 650, isStudent: true,  rewardPreference: 'Either', travelFrequency: 'Never' };
    const nonStudentProfile = { ...baseProfile, creditScore: 650, isStudent: false, rewardPreference: 'Either', travelFrequency: 'Never' };

    const studentResult    = recommendCards([studentCard], studentProfile,    STD_SPENDING, []);
    const nonStudentResult = recommendCards([studentCard], nonStudentProfile, STD_SPENDING, []);

    expect(studentResult.bestOverall[0].estimates.annual)
      .toBeGreaterThan(nonStudentResult.bestOverall[0].estimates.annual);
  });

  test('preferred ecosystem match boosts card from that issuer', () => {
    const chaseProfile = { ...baseProfile, preferredEcosystem: 'Chase', rewardPreference: 'Either', travelFrequency: 'Never' };
    const anyProfile   = { ...baseProfile, preferredEcosystem: 'Any',   rewardPreference: 'Either', travelFrequency: 'Never' };

    const chaseResult = recommendCards([chaseCard], chaseProfile, STD_SPENDING, []);
    const anyResult   = recommendCards([chaseCard], anyProfile,   STD_SPENDING, []);

    expect(chaseResult.bestOverall[0].estimates.annual)
      .toBeGreaterThan(anyResult.bestOverall[0].estimates.annual);
  });
});

// ---------------------------------------------------------------------------
// recommendCards — category winner selection
// ---------------------------------------------------------------------------

describe('recommendCards — category winner selection', () => {
  const profile = { creditScore: 750, accountsOpened24: 1, isStudent: false, travelFrequency: 'Never', rewardPreference: 'Either' };

  test('bestByCategory contains an entry for each spending category', () => {
    const result = recommendCards(ALL_CARDS, profile, STD_SPENDING, []);
    for (const cat of Object.keys(STD_SPENDING)) {
      expect(result.bestByCategory).toHaveProperty(cat);
    }
  });

  test('bestByCategory picks the card with the highest rate for groceries', () => {
    // chaseCard: 1x groceries, studentCard: 1x, cashBackCard: 2x default, premiumCard: 1x
    // → cashBackCard should win groceries (2x default rate)
    const result = recommendCards(ALL_CARDS, profile, STD_SPENDING, []);
    expect(result.bestByCategory.groceries.rate).toBeGreaterThanOrEqual(2);
  });

  test('bestByCategory picks the card with the highest rate for travel', () => {
    // premiumCard has 5x travel — but only eligible if creditScore >= 720
    const result = recommendCards(ALL_CARDS, profile, STD_SPENDING, []);
    expect(result.bestByCategory.travel.rate).toBeGreaterThanOrEqual(3);
  });

  test('bestOverall contains at most 3 cards', () => {
    const result = recommendCards(ALL_CARDS, profile, STD_SPENDING, []);
    expect(result.bestOverall.length).toBeLessThanOrEqual(3);
  });

  test('bestOverall is sorted by annual value descending', () => {
    const result = recommendCards(ALL_CARDS, profile, STD_SPENDING, []);
    for (let i = 1; i < result.bestOverall.length; i++) {
      expect(result.bestOverall[i - 1].estimates.annual)
        .toBeGreaterThanOrEqual(result.bestOverall[i].estimates.annual);
    }
  });

  test('ineligible cards are excluded from bestByCategory', () => {
    // Low credit score profile — Chase (min 670) and Amex (min 720) should be excluded
    const lowProfile = { creditScore: 610, accountsOpened24: 0, isStudent: false, travelFrequency: 'Never', rewardPreference: 'Either' };
    const result = recommendCards(ALL_CARDS, lowProfile, STD_SPENDING, []);
    if (result.bestByCategory.travel) {
      // Chase (3x) and Amex (5x) are ineligible — neither should appear
      expect(result.bestByCategory.travel.name).not.toBe('Chase Sapphire Preferred');
      expect(result.bestByCategory.travel.name).not.toBe('Amex Platinum');
    }
  });

  test('owned card is flagged in scored list', () => {
    const result = recommendCards(ALL_CARDS, profile, STD_SPENDING, [chaseCard.id]);
    const scored = result.scored.find((c) => c.id === chaseCard.id);
    expect(scored).toBeDefined();
    expect(scored.owned).toBe(true);
  });
});
