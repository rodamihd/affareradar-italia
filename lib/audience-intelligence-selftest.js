import { buildAudienceMatrix, recommendChannels } from "./audience-intelligence.js";

export function runAudienceIntelligenceSelfTest() {
  const rows = [
    {
      category:"fiber",
      channel:"telegram",
      impressions:1000,
      clicks:80,
      leads:20,
      activations:8,
      verifiedRevenueEUR:240
    },
    {
      category:"fiber",
      channel:"instagram",
      impressions:1200,
      clicks:90,
      leads:10,
      activations:2,
      verifiedRevenueEUR:60
    },
    {
      category:"software_ai",
      channel:"youtube",
      impressions:500,
      clicks:60,
      leads:18,
      activations:7,
      verifiedRevenueEUR:210
    }
  ];

  const matrix = buildAudienceMatrix(rows);
  const fiber = recommendChannels(rows, "fiber", { minConfidence:"MEDIUM" });

  return {
    ok:
      matrix.matrix.fiber.telegram.performance.confidence === "HIGH" &&
      fiber.ranked.length === 2 &&
      fiber.ranked[0].channel === "telegram" &&
      fiber.ranked[0].performance.revenuePer1000Impressions >
        fiber.ranked[1].performance.revenuePer1000Impressions,
    testedAt:new Date().toISOString(),
    matrix,
    fiber
  };
}
