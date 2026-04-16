function escapeRegex(value) {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function globToRegex(pattern) {
  const token = "__DOUBLE_STAR__";
  const escaped = escapeRegex(pattern)
    .replace(/\*\*/g, token)
    .replace(/\*/g, "[^/]*")
    .replace(new RegExp(token, "g"), ".*");
  return new RegExp(`^${escaped}$`);
}

function compilePatterns(patterns) {
  return patterns.map((pattern) => ({
    pattern,
    regex: globToRegex(pattern)
  }));
}

function findOwner(file, ownersMap) {
  let best = null;
  for (const [pattern, owner] of Object.entries(ownersMap || {})) {
    const regex = globToRegex(pattern);
    if (!regex.test(file)) {
      continue;
    }
    if (!best || pattern.length > best.pattern.length) {
      best = { pattern, owner };
    }
  }
  return best ? best.owner : null;
}

function annotateImpactedFiles(impacted, policies) {
  const criticalMatchers = compilePatterns(policies.criticalPaths || []);
  return impacted.map((item) => {
    const critical = criticalMatchers.some(({ regex }) => regex.test(item.file));
    const owner = findOwner(item.file, policies.owners || {});
    return {
      ...item,
      critical,
      owner
    };
  });
}

function riskToRank(risk) {
  if (risk === "HIGH") {
    return 3;
  }
  if (risk === "MEDIUM") {
    return 2;
  }
  return 1;
}

function evaluateCiViolations(impacted, policies, overrideRiskThreshold) {
  const ci = policies.ci || {};
  const threshold = (overrideRiskThreshold || ci.failOnRisk || "HIGH").toUpperCase();
  const thresholdRank = riskToRank(threshold);

  const overThreshold = impacted.filter(
    (item) => riskToRank(item.risk) >= thresholdRank
  );
  const criticalHits =
    ci.failOnCritical === true
      ? impacted.filter((item) => item.critical)
      : [];

  const violations = [];
  if (overThreshold.length > 0) {
    violations.push({
      type: "risk_threshold",
      threshold,
      files: overThreshold.map((item) => item.file)
    });
  }
  if (criticalHits.length > 0) {
    violations.push({
      type: "critical_paths",
      files: criticalHits.map((item) => item.file)
    });
  }

  return {
    threshold,
    violations
  };
}

module.exports = {
  annotateImpactedFiles,
  evaluateCiViolations,
  globToRegex
};
