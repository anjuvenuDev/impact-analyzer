function bfsReverseTraversal(reverseGraph, startNodes) {
  const distances = new Map();
  const queue = [];

  for (const node of startNodes) {
    if (distances.has(node)) {
      continue;
    }
    distances.set(node, 0);
    queue.push(node);
  }

  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor++];
    const currentDistance = distances.get(current);
    const neighbors = reverseGraph.get(current) || new Set();

    for (const neighbor of neighbors) {
      if (distances.has(neighbor)) {
        continue;
      }
      distances.set(neighbor, currentDistance + 1);
      queue.push(neighbor);
    }
  }

  return distances;
}

function traverseReverseImpact(reverseGraph, startNodes, maxDepth = Infinity) {
  const distances = new Map();
  const parents = new Map();
  const queue = [];

  for (const node of startNodes) {
    if (distances.has(node)) {
      continue;
    }
    distances.set(node, 0);
    queue.push(node);
  }

  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor++];
    const currentDistance = distances.get(current);
    if (currentDistance >= maxDepth) {
      continue;
    }

    const neighbors = reverseGraph.get(current) || new Set();
    for (const neighbor of neighbors) {
      if (distances.has(neighbor)) {
        continue;
      }
      distances.set(neighbor, currentDistance + 1);
      parents.set(neighbor, current);
      queue.push(neighbor);
    }
  }

  return { distances, parents };
}

function buildPathToSeed(node, parents) {
  const path = [node];
  const seen = new Set([node]);
  let cursor = node;

  while (parents.has(cursor)) {
    const parent = parents.get(cursor);
    if (seen.has(parent)) {
      break;
    }
    path.push(parent);
    seen.add(parent);
    cursor = parent;
  }

  return path;
}

function getFanIn(reverseGraph, node) {
  return (reverseGraph.get(node) || new Set()).size;
}

function getOutDegree(graph, node) {
  return (graph.get(node) || new Set()).size;
}

module.exports = {
  traverseReverseImpact,
  buildPathToSeed,
  bfsReverseTraversal,
  getFanIn,
  getOutDegree
};
