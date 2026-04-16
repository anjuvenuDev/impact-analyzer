function generateVisualizationPayload(report, { graph, reverseGraph }) {
  const byFile = new Map(report.impacted.map((item) => [item.file, item]));
  const nodes = Array.from(graph.keys())
    .sort()
    .map((file) => {
      const impact = byFile.get(file);
      return {
        id: file,
        risk: impact ? impact.risk : "NONE",
        score: impact ? impact.score : 0,
        impacted: Boolean(impact)
      };
    });

  const edges = [];
  for (const [from, deps] of graph.entries()) {
    for (const to of deps) {
      edges.push({ from, to });
    }
  }

  return {
    nodes,
    edges,
    stats: {
      nodeCount: graph.size,
      reverseNodeCount: reverseGraph.size
    }
  };
}

module.exports = {
  generateVisualizationPayload
};
