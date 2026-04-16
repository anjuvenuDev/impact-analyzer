const fs = require("fs/promises");
const path = require("path");

const CACHE_VERSION = 1;

function buildCachePath(repoRoot, configCachePath) {
  if (path.isAbsolute(configCachePath)) {
    return configCachePath;
  }
  return path.join(repoRoot, configCachePath);
}

async function readCacheFile(cachePath) {
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed.version !== CACHE_VERSION) {
      return null;
    }
    return parsed;
  } catch (_error) {
    return null;
  }
}

function createEmptyCache(resolverFingerprint) {
  return {
    version: CACHE_VERSION,
    resolverFingerprint,
    files: {}
  };
}

async function loadCache({ repoRoot, cacheFile, enabled, resolverFingerprint }) {
  if (!enabled) {
    return {
      enabled: false,
      path: buildCachePath(repoRoot, cacheFile),
      data: createEmptyCache(resolverFingerprint)
    };
  }

  const cachePath = buildCachePath(repoRoot, cacheFile);
  const existing = await readCacheFile(cachePath);
  if (!existing || existing.resolverFingerprint !== resolverFingerprint) {
    return {
      enabled: true,
      path: cachePath,
      data: createEmptyCache(resolverFingerprint)
    };
  }

  return {
    enabled: true,
    path: cachePath,
    data: existing
  };
}

async function getFileSignature(absPath) {
  try {
    const stat = await fs.stat(absPath);
    return `${stat.size}:${Number(stat.mtimeMs).toFixed(0)}`;
  } catch (_error) {
    return null;
  }
}

function getCachedFileEntry(cacheState, file) {
  return cacheState.data.files[file] || null;
}

function setCachedFileEntry(cacheState, file, entry) {
  cacheState.data.files[file] = entry;
}

function pruneCache(cacheState, validFiles) {
  const valid = new Set(validFiles);
  for (const file of Object.keys(cacheState.data.files)) {
    if (!valid.has(file)) {
      delete cacheState.data.files[file];
    }
  }
}

async function saveCache(cacheState) {
  if (!cacheState.enabled) {
    return;
  }
  const outputDir = path.dirname(cacheState.path);
  await fs.mkdir(outputDir, { recursive: true });
  const payload = JSON.stringify(cacheState.data, null, 2);
  await fs.writeFile(cacheState.path, `${payload}\n`, "utf8");
}

module.exports = {
  loadCache,
  saveCache,
  pruneCache,
  getFileSignature,
  getCachedFileEntry,
  setCachedFileEntry
};
