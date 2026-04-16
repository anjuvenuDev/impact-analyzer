const fs = require("fs/promises");
const path = require("path");

const DEFAULT_CONFIG = {
  ignore: ["node_modules", ".git"],
  extensions: [".js", ".ts", ".jsx", ".tsx"],
  cache: {
    enabled: true,
    file: ".impact-cache.json"
  },
  policies: {
    criticalPaths: [],
    owners: {},
    ci: {
      failOnRisk: "HIGH",
      failOnCritical: false
    }
  },
  validation: {
    forecastsFile: ".impact-forecasts.jsonl",
    metricsFile: ".impact-validation.jsonl"
  }
};

function normalizeArray(value, fallback) {
  return Array.isArray(value) ? value : fallback;
}

function normalizeObject(value, fallback) {
  return value && typeof value === "object" ? value : fallback;
}

function normalizeConfig(parsed) {
  const merged = {
    ...DEFAULT_CONFIG,
    ...parsed
  };

  const policies = normalizeObject(merged.policies, DEFAULT_CONFIG.policies);
  const policyCi = normalizeObject(policies.ci, DEFAULT_CONFIG.policies.ci);
  const validation = normalizeObject(merged.validation, DEFAULT_CONFIG.validation);
  const cache = normalizeObject(merged.cache, DEFAULT_CONFIG.cache);

  return {
    ...merged,
    ignore: normalizeArray(merged.ignore, DEFAULT_CONFIG.ignore),
    extensions: normalizeArray(merged.extensions, DEFAULT_CONFIG.extensions),
    cache: {
      enabled:
        typeof cache.enabled === "boolean"
          ? cache.enabled
          : DEFAULT_CONFIG.cache.enabled,
      file: cache.file || DEFAULT_CONFIG.cache.file
    },
    policies: {
      criticalPaths: normalizeArray(
        policies.criticalPaths,
        DEFAULT_CONFIG.policies.criticalPaths
      ),
      owners: normalizeObject(policies.owners, DEFAULT_CONFIG.policies.owners),
      ci: {
        failOnRisk: policyCi.failOnRisk || DEFAULT_CONFIG.policies.ci.failOnRisk,
        failOnCritical:
          typeof policyCi.failOnCritical === "boolean"
            ? policyCi.failOnCritical
            : DEFAULT_CONFIG.policies.ci.failOnCritical
      }
    },
    validation: {
      forecastsFile:
        validation.forecastsFile || DEFAULT_CONFIG.validation.forecastsFile,
      metricsFile: validation.metricsFile || DEFAULT_CONFIG.validation.metricsFile
    }
  };
}

async function loadConfig(repoRoot) {
  const configPath = path.join(repoRoot, "impact.config.json");
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeConfig(parsed);
  } catch (_error) {
    return DEFAULT_CONFIG;
  }
}

module.exports = {
  loadConfig,
  normalizeConfig,
  DEFAULT_CONFIG
};
