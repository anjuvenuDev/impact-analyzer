const fs = require("fs/promises");
const path = require("path");
const { extractDependencySpecifiers } = require("./astDependencyExtractor");
const { resolveDependencySpecifier } = require("../resolution/resolutionService");
const {
  loadCache,
  saveCache,
  pruneCache,
  getFileSignature,
  getCachedFileEntry,
  setCachedFileEntry
} = require("../cache/cacheService");

const PARSER_CACHE_VERSION = 2;

function dedupeAndSort(values) {
  return Array.from(new Set(values)).sort();
}

async function parseSingleFile(file, sourceCode, resolutionContext) {
  const extracted = extractDependencySpecifiers(sourceCode);
  const dependencies = [];
  const importLines = [];

  for (const item of extracted) {
    const resolved = resolveDependencySpecifier(
      file,
      item.specifier,
      resolutionContext
    );
    if (!resolved) {
      continue;
    }

    dependencies.push(resolved);
    importLines.push({
      line: item.line,
      text: item.text,
      specifier: item.specifier,
      resolved
    });
  }

  return {
    dependencies: dedupeAndSort(dependencies),
    importLines
  };
}

async function buildDependencyModel(
  files,
  repoRoot,
  resolutionContext,
  cacheConfig = { enabled: false, file: ".impact-cache.json" }
) {
  const dependencyMap = {};
  const importLineMap = {};
  const stats = {
    parsedFiles: 0,
    cachedFiles: 0,
    failedFiles: 0
  };

  const cacheState = await loadCache({
    repoRoot,
    cacheFile: cacheConfig.file,
    enabled: Boolean(cacheConfig.enabled),
    resolverFingerprint: resolutionContext.fingerprint
  });

  for (const file of files) {
    const absolute = path.join(repoRoot, file);
    const signature = await getFileSignature(absolute);
    if (!signature) {
      dependencyMap[file] = [];
      importLineMap[file] = [];
      stats.failedFiles += 1;
      continue;
    }

    const cached = getCachedFileEntry(cacheState, file);
    if (
      cached &&
      cached.signature === signature &&
      cached.parserCacheVersion === PARSER_CACHE_VERSION
    ) {
      dependencyMap[file] = cached.dependencies || [];
      importLineMap[file] = cached.importLines || [];
      stats.cachedFiles += 1;
      continue;
    }

    let sourceCode;
    try {
      sourceCode = await fs.readFile(absolute, "utf8");
    } catch (_error) {
      dependencyMap[file] = [];
      importLineMap[file] = [];
      stats.failedFiles += 1;
      continue;
    }

    let parsed;
    try {
      parsed = await parseSingleFile(file, sourceCode, resolutionContext);
    } catch (_error) {
      parsed = { dependencies: [], importLines: [] };
      stats.failedFiles += 1;
    }

    dependencyMap[file] = parsed.dependencies;
    importLineMap[file] = parsed.importLines;
    setCachedFileEntry(cacheState, file, {
      signature,
      parserCacheVersion: PARSER_CACHE_VERSION,
      dependencies: parsed.dependencies,
      importLines: parsed.importLines
    });
    stats.parsedFiles += 1;
  }

  pruneCache(cacheState, files);
  await saveCache(cacheState);

  return {
    dependencyMap,
    importLineMap,
    stats
  };
}

async function buildDependencyMap(
  files,
  repoRoot,
  resolutionContext,
  cacheConfig
) {
  const { dependencyMap } = await buildDependencyModel(
    files,
    repoRoot,
    resolutionContext,
    cacheConfig
  );
  return dependencyMap;
}

module.exports = {
  buildDependencyModel,
  buildDependencyMap,
  resolveDependency: resolveDependencySpecifier
};
