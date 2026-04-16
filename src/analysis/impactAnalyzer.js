const {
  traverseReverseImpact,
  buildPathToSeed,
  getFanIn
} = require("../graph/graphUtils");

function unique(values) {
  return Array.from(new Set(values));
}

function analyzeImpact({ seedFiles, graph, reverseGraph, maxDepth = Infinity }) {
  const changed = unique(seedFiles);
  const graphNodes = new Set(graph.keys());

  const seedNodes = changed.filter((file) => graphNodes.has(file));
  const { distances, parents } = traverseReverseImpact(
    reverseGraph,
    seedNodes,
    maxDepth
  );

  const impacted = [];
  for (const [node, distance] of distances.entries()) {
    const pathToSeed = buildPathToSeed(node, parents);
    impacted.push({
      file: node,
      depth: distance,
      distance,
      dependents: getFanIn(reverseGraph, node),
      fanIn: getFanIn(reverseGraph, node),
      dependencies: Array.from(graph.get(node) || []).sort(),
      isChanged: changed.includes(node),
      pathToSeed
    });
  }

  impacted.sort((a, b) => {
    if (a.depth !== b.depth) {
      return a.depth - b.depth;
    }
    return a.file.localeCompare(b.file);
  });

  return {
    seeds: changed,
    impacted
  };
}

module.exports = {
  analyzeImpact
};
