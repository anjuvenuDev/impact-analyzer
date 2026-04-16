function buildExplanations(report) {
  const changedSet = new Set(report.changed);

  return report.impacted.map((item) => {
    if (changedSet.has(item.file)) {
      return {
        file: item.file,
        explanation: `${item.file} is directly changed in the selected commit range.`
      };
    }

    const chain =
      Array.isArray(item.pathToSeed) && item.pathToSeed.length > 1
        ? item.pathToSeed.join(" -> ")
        : "reachable from changed files";

    return {
      file: item.file,
      explanation: `${item.file} is impacted via ${chain}.`
    };
  });
}

module.exports = {
  buildExplanations
};
