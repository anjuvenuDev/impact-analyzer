const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

function resolvePath(repoRoot, maybeRelative) {
  return path.isAbsolute(maybeRelative)
    ? maybeRelative
    : path.join(repoRoot, maybeRelative);
}

async function appendJsonLine(filePath, payload) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(payload)}\n`, "utf8");
}

async function readJsonLines(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const records = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      try {
        records.push(JSON.parse(line));
      } catch (_error) {
        continue;
      }
    }
    return records;
  } catch (_error) {
    return [];
  }
}

function computeOverlapMetrics(predicted, actual) {
  const predictedSet = new Set(predicted);
  const actualSet = new Set(actual);

  let truePositives = 0;
  for (const file of predictedSet) {
    if (actualSet.has(file)) {
      truePositives += 1;
    }
  }

  const falsePositives = predictedSet.size - truePositives;
  const falseNegatives = actualSet.size - truePositives;

  const precision =
    predictedSet.size === 0 ? 1 : truePositives / predictedSet.size;
  const recall = actualSet.size === 0 ? 1 : truePositives / actualSet.size;
  const f1 =
    precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return {
    truePositives,
    falsePositives,
    falseNegatives,
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1: Number(f1.toFixed(4))
  };
}

async function recordForecast(repoRoot, validationConfig, report, options = {}) {
  const filePath = resolvePath(repoRoot, validationConfig.forecastsFile);
  const now = new Date().toISOString();
  const forecastId = crypto
    .createHash("sha1")
    .update(
      JSON.stringify({
        now,
        changed: report.changed,
        impacted: report.impacted.map((item) => item.file)
      })
    )
    .digest("hex")
    .slice(0, 12);

  const record = {
    forecastId,
    createdAt: now,
    mode: report.mode,
    changed: report.changed,
    predictedImpacted: report.impacted.map((item) => item.file),
    metadata: report.metadata,
    tags: options.tags || []
  };

  await appendJsonLine(filePath, record);
  return record;
}

async function getLatestForecast(repoRoot, validationConfig) {
  const filePath = resolvePath(repoRoot, validationConfig.forecastsFile);
  const records = await readJsonLines(filePath);
  if (records.length === 0) {
    return null;
  }
  return records[records.length - 1];
}

async function recordValidationRun(
  repoRoot,
  validationConfig,
  forecast,
  actualChanged,
  extra = {}
) {
  const filePath = resolvePath(repoRoot, validationConfig.metricsFile);
  const metrics = computeOverlapMetrics(forecast.predictedImpacted, actualChanged);
  const record = {
    validatedAt: new Date().toISOString(),
    forecastId: forecast.forecastId,
    predictedCount: forecast.predictedImpacted.length,
    actualCount: actualChanged.length,
    metrics,
    actualChanged,
    ...extra
  };
  await appendJsonLine(filePath, record);
  return record;
}

function summarizeMetrics(records) {
  if (records.length === 0) {
    return {
      runs: 0,
      avgPrecision: null,
      avgRecall: null,
      avgF1: null
    };
  }

  let precision = 0;
  let recall = 0;
  let f1 = 0;
  for (const record of records) {
    precision += record.metrics ? record.metrics.precision : 0;
    recall += record.metrics ? record.metrics.recall : 0;
    f1 += record.metrics ? record.metrics.f1 : 0;
  }

  return {
    runs: records.length,
    avgPrecision: Number((precision / records.length).toFixed(4)),
    avgRecall: Number((recall / records.length).toFixed(4)),
    avgF1: Number((f1 / records.length).toFixed(4))
  };
}

async function loadMetricsSummary(repoRoot, validationConfig) {
  const filePath = resolvePath(repoRoot, validationConfig.metricsFile);
  const records = await readJsonLines(filePath);
  return {
    summary: summarizeMetrics(records),
    records
  };
}

module.exports = {
  recordForecast,
  getLatestForecast,
  recordValidationRun,
  loadMetricsSummary
};
