const { getOutDegree } = require("../graph/graphUtils");

const DEFAULT_SCORING = {
  distanceWeight: 6,
  centralityWeight: 2,
  dependentWeight: 1
};

function calculateRisk(score) {
  if (score >= 8) {
    return "HIGH";
  }
  if (score >= 4) {
    return "MEDIUM";
  }
  return "LOW";
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function scoreImpacts(
  impacted,
  { graph, reverseGraph },
  scoringConfig = DEFAULT_SCORING
) {
  const nodeCount = Math.max(graph.size, 1);

  return impacted
    .map((entry) => {
      const outDegree = getOutDegree(graph, entry.file);
      const degreeCentrality = (entry.dependents + outDegree) / nodeCount;
      const distanceComponent =
        entry.depth === 0
          ? scoringConfig.distanceWeight * 2
          : scoringConfig.distanceWeight / entry.depth;

      const rawScore =
        scoringConfig.dependentWeight * entry.dependents +
        distanceComponent +
        scoringConfig.centralityWeight * degreeCentrality;

      const score = round2(rawScore);
      const risk = calculateRisk(score);

      return {
        ...entry,
        score,
        risk
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.file.localeCompare(b.file);
    });
}

module.exports = {
  scoreImpacts,
  calculateRisk,
  DEFAULT_SCORING
};
