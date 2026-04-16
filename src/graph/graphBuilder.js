function buildDependencyGraph(dependencyMap) {
  const graph = new Map();
  const reverseGraph = new Map();

  for (const [file, dependencies] of Object.entries(dependencyMap)) {
    if (!graph.has(file)) {
      graph.set(file, new Set());
    }
    if (!reverseGraph.has(file)) {
      reverseGraph.set(file, new Set());
    }

    for (const dep of dependencies) {
      if (!graph.has(dep)) {
        graph.set(dep, new Set());
      }
      if (!reverseGraph.has(dep)) {
        reverseGraph.set(dep, new Set());
      }

      graph.get(file).add(dep);
      reverseGraph.get(dep).add(file);
    }
  }

  return { graph, reverseGraph };
}

module.exports = {
  buildDependencyGraph
};
