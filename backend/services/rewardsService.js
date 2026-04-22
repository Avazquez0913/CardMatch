/*
  Rewards Service - Calculates card recommendations based on user profile
  This service:
  1. Filters eligible cards based on credit score and rules
  2. Calculates estimated rewards for each eligible card
  3. Applies multipliers based on user preferences
  4. Ranks cards by annual rewards value
  5. Returns top recommendations with explanations
*/

/** Version string incremented whenever the scoring logic changes. */
const ALGO_VERSION = 'v1.0';

/** Chase 5/24 limit: blocked if this many accounts opened in 24 months. */
const CHASE_524_LIMIT = 5;

/**
 * Returns the human-readable reason a card is ineligible for the given profile,
 * or null if the card is eligible. Mirrors the logic in isEligible exactly so
 * the two functions never diverge.
 *
 * @param {object} card    - Card object from the catalog.
 * @param {object} profile - User profile from the request.
 * @returns {string|null}  Reason string, or null if eligible.
 */
function getExclusionReason(card, profile) {
  if (!card.minCreditScore) return null;
  if (!profile || typeof profile.creditScore !== 'number') return null;

  if (profile.accountsOpened24 >= CHASE_524_LIMIT &&
      String(card.issuer).toLowerCase() === 'chase') {
    return `5/24 rule: ${profile.accountsOpened24} accounts opened in 24 months`;
  }

  const level = (card.level || '').toLowerCase();

  if (profile.creditScore < 630) {
    if (!(card.secured || level === 'beginner' || level === 'student')) {
      return `Credit score ${profile.creditScore} too low for ${level || 'mid'}-level cards (minimum 630)`;
    }
  }

  if (profile.creditScore >= 630 && profile.creditScore < 680) {
    if (level === 'premium') {
      return `Credit score ${profile.creditScore} below 680 required for premium cards`;
    }
  }

  if (profile.creditScore < card.minCreditScore) {
    return `Credit score ${profile.creditScore} below minimum requirement of ${card.minCreditScore}`;
  }

  return null;
}

/**
 * Returns the spending category with the highest monthly spend.
 *
 * @param {object} spending - Map of category → monthly spend amount.
 * @returns {string} The dominant category name.
 */
function getDominantCategory(spending) {
  let top = null;
  let max = -Infinity;
  for (const [cat, amount] of Object.entries(spending || {})) {
    if (amount > max) { max = amount; top = cat; }
  }
  return top;
}

/**
 * Builds the top_card_reasoning template string for the #1 ranked card.
 *
 * @param {object} topCard     - The highest-ranked scored card object.
 * @param {object} rawCard     - The raw catalog card (for reward rates and fee).
 * @param {string} dominantCat - The user's dominant spending category.
 * @param {object} spending    - The user's spending breakdown.
 * @returns {string} Human-readable reasoning sentence.
 */
function buildTopCardReasoning(topCard, rawCard, dominantCat, spending) {
  const monthlySpend = spending[dominantCat] || 0;
  const rate = (rawCard.rewards && (rawCard.rewards[dominantCat] || rawCard.rewards.default)) || 1;
  const fee  = rawCard.annualFee || 0;
  const monthsToOffset = fee > 0
    ? Math.ceil(fee / (topCard.estimates.annual + fee) * 12)
    : 0;

  const feeNote = fee > 0
    ? ` Annual fee of $${fee} is offset after month ${monthsToOffset}.`
    : ' No annual fee.';

  return (
    `${topCard.name} ranked #1 because your $${monthlySpend}/month ${dominantCat} spend ` +
    `triggers a ${rate}x reward rate.` +
    feeNote
  );
}

// Check if a user is eligible for a specific card
function isEligible(card, profile) {
  // If card has no min score, everyone is eligible
  if (!card.minCreditScore) return true;
  // If no profile data, allow it
  if (!profile || typeof profile.creditScore !== "number") return true;

  // Chase 5/24 rule: if user opened 5+ accounts in 24 months, they can't get Chase cards
  if (
    profile.accountsOpened24 >= 5 &&
    String(card.issuer).toLowerCase() === "chase"
  ) {
    return false;
  }

  const level = (card.level || "").toLowerCase();

  // If credit score is very low (< 630), only show secured/beginner/student cards
  if (profile.creditScore < 630) {
    if (!(card.secured || level === "beginner" || level === "student")) {
      return false;
    }
  }

  // If credit score is mid-range (630-680), don't show premium cards
  if (profile.creditScore >= 630 && profile.creditScore < 680) {
    if (level === "premium") return false;
  }

  // Finally, check that credit score meets the card's minimum
  return profile.creditScore >= card.minCreditScore;
}

// Calculate estimated rewards for a card based on user's spending
function estimateRewardsForCard(card, spending) {
  // Point value is how much each point is worth (e.g., 0.96 cents per point)
  const pointValueCents =
    typeof card.pointValueCents === "number" ? card.pointValueCents : 1.0;

  let annual = 0;

  // Go through each spending category and calculate rewards
  for (const [cat, amount] of Object.entries(spending || {})) {
    // Get the reward rate for this category (or default if not specified)
    const rate =
      (card.rewards && (card.rewards[cat] || card.rewards.default)) || 0;

    // Formula: monthly * 12 months * rate * value per point
    const annualValue = amount * 12 * rate * (pointValueCents / 100);
    annual += annualValue;
  }

  // Subtract annual fee if there is one
  if (card.annualFee && card.annualFee > 0) {
    annual -= card.annualFee;
  }

  // Round to 2 decimal places
  const annualRounded = Number(annual.toFixed(2));
  const monthlyRounded = Number((annualRounded / 12).toFixed(2));

  return { monthly: monthlyRounded, annual: annualRounded };
}

// Main function that recommends cards to a user
function recommendCards(cards, profile, spending, ownedCards = []) {
  // Separate eligible from ineligible, collecting a reason for each exclusion
  const eligible = [];
  const excludedCards = [];

  for (const card of cards) {
    const reason = getExclusionReason(card, profile);
    if (reason === null) {
      eligible.push(card);
    } else {
      excludedCards.push({ name: card.name, reason });
    }
  }

  // Track which cards the user already owns
  const ownedNames = new Set();
  const ownedIssuers = new Set();

  // Look through owned cards and find them in our card list
  for (const o of ownedCards) {
    const found = cards.find(
      (c) =>
        String(c.name).toLowerCase() === String(o).toLowerCase() ||
        String(c.id) === String(o)
    );
    if (found) {
      ownedNames.add(found.name);
      ownedIssuers.add(found.issuer);
    }
  }

  // Get user preferences
  const ecosPref =
    profile.preferredEcosystem || profile.ecosystem || "Any";
  const travelFreq =
    profile.travelFrequency || profile.travelFreq || "Never";
  const rewardPref =
    profile.rewardPreference || profile.rewardPref || "Cash Back";

  // Score each eligible card
  const scored = eligible.map((card) => {
    let reasons = []; // Track WHY we recommend this card
    const base = estimateRewardsForCard(card, spending);
    let multiplier = 1.0; // We'll multiply the base rewards by this

    const issuer = (card.ecosystem || card.issuer || "").toLowerCase();
    const level = (card.level || "").toLowerCase();

    // Boost score for students if the card is student-friendly
    if (profile.isStudent && card.studentFriendly) {
      multiplier *= 1.2;
      reasons.push("Good for students");
    }

    // Boost score if card matches preferred ecosystem
    if (ecosPref && ecosPref !== "Any") {
      if (issuer.includes(ecosPref.toLowerCase())) {
        multiplier *= 1.1;
        reasons.push(`Matches preferred ecosystem (${ecosPref})`);
      }
    }

    // Ecosystem synergy: if you own one card, another works better
    // Example: Chase Freedom + Sapphire Preferred work together
    if (
      ownedNames.has("Chase Freedom Flex") ||
      ownedNames.has("Chase Freedom Unlimited")
    ) {
      if (card.name.toLowerCase().includes("sapphire")) {
        multiplier *= 1.4;
        reasons.push("Boosted because you own Chase Freedom — strong pairing");
      }
    }

    if (ownedNames.has("Amex Gold")) {
      if (card.name.toLowerCase().includes("platinum")) {
        multiplier *= 1.4;
        reasons.push("Boosted due to Amex ecosystem synergy");
      }
    }

    if (ownedNames.has("Capital One SavorOne")) {
      if (card.name.toLowerCase().includes("venture")) {
        multiplier *= 1.4;
        reasons.push("Works well with Venture ecosystem you already have");
      }
    }

    // Minor boost if card is from same issuer as card you already own
    if (ownedIssuers.has(card.ecosystem || card.issuer)) {
      multiplier *= 1.05;
      reasons.push("Same ecosystem as cards you already own");
    }

    // Helper function to get reward rate for a category
    const r = (cat) =>
      (card.rewards && (card.rewards[cat] || card.rewards.default)) || 0;

    // If user prefers cash back, boost flat-rate cards
    if (rewardPref === "Cash Back") {
      const strongCash = r("groceries") + r("dining") >= 6;
      if (strongCash) {
        multiplier *= 1.07;
        reasons.push("Strong cash back benefits");
      }
      // Penalize premium travel cards for cash-back users
      if (level === "premium" && r("travel") >= 3) {
        multiplier *= 0.9;
        reasons.push("Premium travel card penalized under cash back preference");
      }
    }

    // If user prefers points/miles, boost travel-heavy cards
    if (rewardPref === "Points/Miles") {
      if (r("travel") >= 3 || r("dining") >= 3) {
        multiplier *= 1.08;
        reasons.push("Optimized for points + travel earning");
      }
      // Penalize pure cash-back cards for points users
      const pureCash =
        (card.rewards && (card.rewards.default || 0) >= 2) &&
        !(r("travel") >= 3 || r("dining") >= 3);
      if (pureCash) {
        multiplier *= 0.95;
        reasons.push("Cash-back card penalized due to points preference");
      }
    }

    // Travel frequency adjustments
    if (String(travelFreq).toLowerCase() === "often" && r("travel") >= 3) {
      multiplier *= 1.1;
      reasons.push("Better for frequent travelers");
    }
    if (String(travelFreq).toLowerCase() === "never" && r("travel") >= 3) {
      multiplier *= 0.8;
      reasons.push("Travel rewards de-emphasized");
    }

    // Boost for cards with rotating categories
    if (card.rotatingCategories) {
      multiplier *= 1.05;
      reasons.push("Rotating category bonus potential");
    }

    // Boost for cards that unlock transfer partners
    if (card.unlockTransferPartners) {
      const match = Array.from(ownedIssuers).some(
        (e) => e.toLowerCase() === issuer
      );
      if (match) {
        multiplier *= 1.4;
        reasons.push("Unlocks transfer partners useful with your existing cards");
      }
    }

    // Apply multiplier to get final score
    const adjustedAnnual = Number((base.annual * multiplier).toFixed(2));
    const adjustedMonthly = Number((adjustedAnnual / 12).toFixed(2));

    // Calculate weighted average rate based on user's spending
    let weightedRate = 0;
    let totalSpending = 0;
    for (const [cat, amount] of Object.entries(spending || {})) {
      const rate = (card.rewards && (card.rewards[cat] || card.rewards.default)) || 0;
      weightedRate += rate * amount;
      totalSpending += amount;
    }
    const avgRate = totalSpending > 0 ? Number((weightedRate / totalSpending).toFixed(2)) : 0;

    // Get top reward categories for display
    const rewardCategories = [];
    if (card.rewards) {
      // Get all categories with their rates, excluding 'default'
      const categories = Object.entries(card.rewards)
        .filter(([cat, rate]) => cat !== 'default' && rate > 1)
        .sort((a, b) => b[1] - a[1]) // Sort by rate descending
        .slice(0, 3); // Get top 3
      
      for (const [cat, rate] of categories) {
        rewardCategories.push({
          category: cat.charAt(0).toUpperCase() + cat.slice(1),
          rate: rate
        });
      }
    }

    return {
      id: card.id,
      name: card.name,
      estimates: {
        monthly: adjustedMonthly,
        annual: adjustedAnnual
      },
      rate: avgRate, // Weighted average rate based on spending
      rewardCategories: rewardCategories, // Top reward categories
      annualFee: card.annualFee || 0,
      level: card.level || 'Mid',
      owned: ownedNames.has(card.name),
      reasons // Explanation list for why this card scored well
    };
  });

  // Find best card by category
  const categories = Object.keys(spending || {});
  const bestByCategory = {};

  for (const cat of categories) {
    let best = null;
    // Look through all eligible cards to find highest rate for this category
    for (const card of eligible) {
      const rate =
        (card.rewards && (card.rewards[cat] || card.rewards.default)) || 0;
      if (!best || rate > best.rate) {
        best = { id: card.id, name: card.name, rate };
      }
    }
    if (best) bestByCategory[cat] = best;
  }

  // Sort by annual rewards and get top 3
  const sorted = scored
    .slice()
    .sort((a, b) => b.estimates.annual - a.estimates.annual);
  const bestOverall = sorted.slice(0, 3);

  // Build explanation object
  const dominantCat = getDominantCategory(spending);
  const topCard     = bestOverall[0] || null;
  const rawTopCard  = topCard ? cards.find((c) => c.id === topCard.id) : null;

  const ecosystemBonusApplied = ecosPref !== 'Any' &&
    eligible.some((c) =>
      (c.ecosystem || c.issuer || '').toLowerCase().includes(ecosPref.toLowerCase())
    );

  const explanation = {
    algo_version: ALGO_VERSION,
    top_card_reasoning: topCard && rawTopCard
      ? buildTopCardReasoning(topCard, rawTopCard, dominantCat, spending)
      : 'No eligible cards found for this profile.',
    excluded_cards: excludedCards,
    profile_signals: {
      dominant_category: dominantCat,
      ecosystem_bonus_applied: ecosystemBonusApplied,
    },
  };

  return { scored, bestByCategory, bestOverall, explanation };
}

module.exports = { isEligible, estimateRewardsForCard, recommendCards, getExclusionReason, ALGO_VERSION };