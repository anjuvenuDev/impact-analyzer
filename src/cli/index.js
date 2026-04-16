#!/usr/bin/env node

const path = require("path");
const readline = require("readline");
const { Command } = require("commander");

const { getRepoRoot, getChangedFiles, normalizeRepoPath } = require("../git/gitService");
const { scanSourceFiles } = require("../scanner/fileScanner");
const { buildDependencyModel } = require("../parser/dependencyParser");
const { buildDependencyGraph } = require("../graph/graphBuilder");
const { analyzeImpact } = require("../analysis/impactAnalyzer");
const { scoreImpacts, DEFAULT_SCORING } = require("../analysis/scoringEngine");
const {
  formatImpactReport,
  formatFocusReport,
  formatMetricsSummary
} = require("../output/formatter");
const { exportJson } = require("../output/exporter");
const { generateVisualizationPayload } = require("../visualization/visualizer");
const { buildExplanations } = require("../ai/explainer");
const { loadConfig } = require("../config/configService");
const { buildResolutionContext } = require("../resolution/resolutionService");
const {
  annotateImpactedFiles,
  evaluateCiViolations
} = require("../policy/policyEngine");
const {
  recordForecast,
  getLatestForecast,
  recordValidationRun,
  loadMetricsSummary
} = require("../metrics/metricsService");
const logger = require("../utils/logger");

function normalizeOutputMode(value) {
  if (!value) {
    return { mode: "cli" };
  }

  const normalized = String(value).toLowerCase();
  if (["cli", "json", "both"].includes(normalized)) {
    return { mode: normalized };
  }
  if (normalized.endsWith(".json")) {
    return { mode: "cli", reportFile: value };
  }
  throw new Error("Invalid --output value. Use cli, json, both, or a .json filepath.");
}

function parseInteger(value, optionName) {
  if (value === undefined || value === null) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`${optionName} must be a non-negative integer.`);
  }
  return parsed;
}

function splitRiskFilter(rawRisk) {
  if (!rawRisk) {
    return null;
  }
  const allowed = new Set(["HIGH", "MEDIUM", "LOW"]);
  const selected = rawRisk
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  for (const risk of selected) {
    if (!allowed.has(risk)) {
      throw new Error(`Invalid risk level: ${risk}`);
    }
  }
  return new Set(selected);
}

function filterByRisk(impacted, riskFilter) {
  if (!riskFilter || riskFilter.size === 0) {
    return impacted;
  }
  return impacted.filter((item) => riskFilter.has(item.risk));
}

function matchExtensions(file, extensions) {
  return extensions.includes(path.extname(file));
}

function normalizeSeedFiles(seedFiles, repoRoot) {
  const normalized = [];
  for (const rawFile of seedFiles) {
    const file = String(rawFile);
    if (path.isAbsolute(file)) {
      const relative = path.relative(repoRoot, file);
      normalized.push(normalizeRepoPath(relative));
      continue;
    }
    normalized.push(normalizeRepoPath(file));
  }
  return Array.from(new Set(normalized));
}

function resolveOutputPath(repoRoot, maybePath) {
  if (!maybePath) {
    return null;
  }
  return path.isAbsolute(maybePath) ? maybePath : path.join(repoRoot, maybePath);
}

function buildCodeInsights(impacted, importLineMap) {
  const insights = [];

  for (const item of impacted) {
    if (!Array.isArray(item.pathToSeed) || item.pathToSeed.length < 2) {
      continue;
    }
    const linkedDependency = item.pathToSeed[1];
    const lines = importLineMap[item.file] || [];
    const match = lines.find((line) => line.resolved === linkedDependency);
    if (!match) {
      continue;
    }
    insights.push({
      file: item.file,
      line: match.line,
      text: match.text,
      dependency: linkedDependency
    });
  }

  return insights;
}

function findMissingSeedFiles(seedFiles, sourceFilesSet) {
  return seedFiles.filter((file) => !sourceFilesSet.has(file));
}

function createScoringConfig(fastMode) {
  if (!fastMode) {
    return DEFAULT_SCORING;
  }
  return {
    ...DEFAULT_SCORING,
    centralityWeight: 0
  };
}

function buildMetadata({
  repoRoot,
  changedFilesDetected,
  changedSourceDetected,
  maxDepth,
  fastMode,
  parserStats,
  resolverFingerprint
}) {
  return {
    repository: repoRoot,
    generatedAt: new Date().toISOString(),
    changedFilesDetected,
    changedSourceDetected,
    maxDepth: Number.isFinite(maxDepth) ? maxDepth : null,
    fastMode,
    parser: parserStats,
    resolverFingerprint
  };
}

function renderReverseTree(reverseGraph, startNode, maxDepth = Infinity) {
  const lines = [startNode];

  function walk(node, prefix, depth, stack) {
    if (depth >= maxDepth) {
      return;
    }

    const children = Array.from(reverseGraph.get(node) || []).sort();
    children.forEach((child, index) => {
      const isLast = index === children.length - 1;
      const branch = isLast ? "└── " : "├── ";
      const childPrefix = `${prefix}${branch}`;

      if (stack.has(child)) {
        lines.push(`${childPrefix}${child} (cycle)`);
        return;
      }

      lines.push(`${childPrefix}${child}`);
      const nextPrefix = `${prefix}${isLast ? "    " : "│   "}`;
      stack.add(child);
      walk(child, nextPrefix, depth + 1, stack);
      stack.delete(child);
    });
  }

  walk(startNode, "", 0, new Set([startNode]));
  return lines.join("\n");
}

function getRootNodes(graph) {
  const roots = [];
  for (const [node, deps] of graph.entries()) {
    if ((deps || new Set()).size === 0) {
      roots.push(node);
    }
  }
  roots.sort();
  return roots;
}

async function buildAnalysisContext(repoRoot, options) {
  const config = await loadConfig(repoRoot);
  const sourceFiles = await scanSourceFiles(repoRoot, {
    extensions: config.extensions,
    excludeDirs: config.ignore
  });
  const sourceFileSet = new Set(sourceFiles);

  const resolutionContext = await buildResolutionContext(
    repoRoot,
    sourceFileSet,
    config.extensions
  );

  const cacheConfig = {
    enabled: options.noCache ? false : config.cache.enabled,
    file: options.cacheFile || config.cache.file
  };

  const { dependencyMap, importLineMap, stats } = await buildDependencyModel(
    sourceFiles,
    repoRoot,
    resolutionContext,
    cacheConfig
  );

  const { graph, reverseGraph } = buildDependencyGraph(dependencyMap);

  return {
    config,
    cacheConfig,
    sourceFiles,
    sourceFileSet,
    importLineMap,
    graph,
    reverseGraph,
    parserStats: stats,
    resolutionContext
  };
}

async function createImpactReport({
  repoRoot,
  mode,
  context,
  seedFiles,
  changedFilesDetected,
  options
}) {
  const depthOption = options.maxDepth ?? options.depth;
  const maxDepth =
    depthOption === undefined ? Infinity : parseInteger(depthOption, "--max-depth");
  const riskFilter = splitRiskFilter(options.risk);
  const scoringConfig = createScoringConfig(Boolean(options.fast));

  const normalizedSeeds = normalizeSeedFiles(seedFiles, repoRoot);
  const missingSeeds = findMissingSeedFiles(normalizedSeeds, context.sourceFileSet);
  if (missingSeeds.length > 0) {
    logger.warn(
      `Seed files not found in scanned source set: ${missingSeeds.join(", ")}`
    );
  }

  const analysis = analyzeImpact({
    seedFiles: normalizedSeeds,
    graph: context.graph,
    reverseGraph: context.reverseGraph,
    maxDepth
  });
  const scored = scoreImpacts(
    analysis.impacted,
    {
      graph: context.graph,
      reverseGraph: context.reverseGraph
    },
    scoringConfig
  );
  const filtered = filterByRisk(scored, riskFilter);
  const annotated = annotateImpactedFiles(filtered, context.config.policies);
  const ciEval = evaluateCiViolations(
    annotated,
    context.config.policies,
    options.ciThreshold
  );

  const report = {
    mode,
    changed: analysis.seeds,
    impacted: annotated,
    policyThreshold: ciEval.threshold,
    policyViolations: ciEval.violations,
    metadata: buildMetadata({
      repoRoot,
      changedFilesDetected,
      changedSourceDetected: normalizedSeeds.length,
      maxDepth,
      fastMode: Boolean(options.fast),
      parserStats: context.parserStats,
      resolverFingerprint: context.resolutionContext.fingerprint
    })
  };

  if (options.why) {
    report.explanations = buildExplanations(report);
  }
  if (options.code) {
    report.codeInsights = buildCodeInsights(annotated, context.importLineMap);
  }

  return report;
}

async function emitReport(report, context, repoRoot, options) {
  const output = normalizeOutputMode(options.output);
  const reportFile = options.reportFile || output.reportFile;

  if (output.mode === "cli" || output.mode === "both") {
    console.log(formatImpactReport(report, { why: options.why, code: options.code }));
  }
  if (output.mode === "json" || output.mode === "both") {
    console.log(JSON.stringify(report, null, 2));
  }

  if (reportFile) {
    const reportPath = resolveOutputPath(repoRoot, reportFile);
    const written = await exportJson(report, reportPath);
    logger.info(`JSON report written to ${written}`);
  }

  if (options.export !== undefined) {
    const exportDirRaw =
      options.export === true || options.export === "" ? "output" : options.export;
    const exportDir = resolveOutputPath(repoRoot, exportDirRaw);
    const impactPath = path.join(exportDir, "impact.json");
    const graphPath = path.join(exportDir, "graph.json");
    const impactWritten = await exportJson(report, impactPath);
    const graphPayload = generateVisualizationPayload(report, {
      graph: context.graph,
      reverseGraph: context.reverseGraph
    });
    const graphWritten = await exportJson(graphPayload, graphPath);
    logger.info(`Exported report: ${impactWritten}`);
    logger.info(`Exported graph: ${graphWritten}`);
  }

  if (report.forecastRecorded) {
    logger.info(`Forecast recorded: ${report.forecastRecorded.forecastId}`);
  }
  if (report.validation) {
    const m = report.validation.metrics;
    logger.info(
      `Validation metrics (P/R/F1): ${m.precision}/${m.recall}/${m.f1}`
    );
  }

  if (options.ci && report.policyViolations && report.policyViolations.length > 0) {
    for (const violation of report.policyViolations) {
      if (violation.type === "risk_threshold") {
        logger.error(
          `CI gate failed: risk >= ${violation.threshold} in ${violation.files.length} file(s).`
        );
      } else if (violation.type === "critical_paths") {
        logger.error(
          `CI gate failed: critical paths impacted (${violation.files.length}).`
        );
      }
    }
    process.exitCode = 2;
  }
}

function parseCheckTargets(positionalTargets, options, repoRoot) {
  const targets = [...(positionalTargets || [])];
  if (options.targets) {
    const fromCsv = options.targets
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    targets.push(...fromCsv);
  }
  return normalizeSeedFiles(targets, repoRoot);
}

async function resolveAnalyzeSeedFiles(repoRoot, context, options) {
  if (options.staged && options.commit) {
    throw new Error("Use either --staged or --commit, not both.");
  }

  const changedAll = await getChangedFiles({
    repoRoot,
    commit: options.commit,
    staged: options.staged
  });
  const changedSource = changedAll.filter((file) =>
    matchExtensions(file, context.config.extensions)
  );
  if (changedSource.length === 0) {
    logger.warn("No changed source files found for selected diff.");
  } else if (changedSource.length !== changedAll.length) {
    logger.info(
      `Using ${changedSource.length} source file(s) out of ${changedAll.length} changed file(s).`
    );
  }

  return { changedAll, changedSource };
}

async function maybeRecordForecast(report, repoRoot, context, options) {
  if (!options.recordForecast) {
    return report;
  }
  const forecast = await recordForecast(
    repoRoot,
    context.config.validation,
    report,
    {
      tags: [report.mode]
    }
  );
  return {
    ...report,
    forecastRecorded: {
      forecastId: forecast.forecastId,
      createdAt: forecast.createdAt
    }
  };
}

async function maybeValidateAgainstLatestForecast(
  report,
  repoRoot,
  context,
  options
) {
  if (!options.validateLatest) {
    return report;
  }
  const latestForecast = await getLatestForecast(repoRoot, context.config.validation);
  if (!latestForecast) {
    logger.warn("No previous forecast found for validation.");
    return report;
  }
  const validation = await recordValidationRun(
    repoRoot,
    context.config.validation,
    latestForecast,
    report.changed,
    {
      mode: report.mode
    }
  );
  return {
    ...report,
    validation
  };
}

async function handleAnalyze(options) {
  const repoRoot = await getRepoRoot(options.repo || process.cwd());
  const context = await buildAnalysisContext(repoRoot, options);
  const { changedAll, changedSource } = await resolveAnalyzeSeedFiles(
    repoRoot,
    context,
    options
  );

  let report = await createImpactReport({
    repoRoot,
    mode: "diff",
    context,
    seedFiles: changedSource,
    changedFilesDetected: changedAll.length,
    options
  });
  report = await maybeValidateAgainstLatestForecast(report, repoRoot, context, options);
  report = await maybeRecordForecast(report, repoRoot, context, options);
  await emitReport(report, context, repoRoot, options);
}

async function handleCheck(targets, options) {
  const repoRoot = await getRepoRoot(options.repo || process.cwd());
  const context = await buildAnalysisContext(repoRoot, options);
  const seedFiles = parseCheckTargets(targets, options, repoRoot);

  if (seedFiles.length === 0) {
    throw new Error(
      "Provide at least one file for simulation (e.g. impact-analyzer check src/auth.ts)."
    );
  }

  let report = await createImpactReport({
    repoRoot,
    mode: "simulation",
    context,
    seedFiles,
    changedFilesDetected: seedFiles.length,
    options
  });
  report = await maybeRecordForecast(report, repoRoot, context, options);
  await emitReport(report, context, repoRoot, options);

  if (options.graph) {
    console.log("");
    const depthOption = options.maxDepth ?? options.depth;
    const graphDepth =
      depthOption === undefined ? Infinity : parseInteger(depthOption, "--max-depth");
    for (const seed of seedFiles) {
      console.log(renderReverseTree(context.reverseGraph, seed, graphDepth));
      console.log("");
    }
  }
}

async function handleGraph(focusFile, options) {
  const repoRoot = await getRepoRoot(options.repo || process.cwd());
  const context = await buildAnalysisContext(repoRoot, options);
  const depthOption = options.maxDepth ?? options.depth;
  const maxDepth =
    depthOption === undefined ? Infinity : parseInteger(depthOption, "--max-depth");

  if (focusFile) {
    const normalized = normalizeSeedFiles([focusFile], repoRoot)[0];
    if (!context.graph.has(normalized)) {
      throw new Error(`File not found in dependency graph: ${normalized}`);
    }
    console.log(renderReverseTree(context.reverseGraph, normalized, maxDepth));
    return;
  }

  const roots = getRootNodes(context.graph);
  if (roots.length === 0) {
    logger.warn("No graph roots found.");
    return;
  }

  for (const root of roots) {
    console.log(renderReverseTree(context.reverseGraph, root, maxDepth));
    console.log("");
  }
}

async function handleFocus(file, options) {
  const repoRoot = await getRepoRoot(options.repo || process.cwd());
  const context = await buildAnalysisContext(repoRoot, options);
  const normalized = normalizeSeedFiles([file], repoRoot)[0];
  if (!context.graph.has(normalized)) {
    throw new Error(`File not found in dependency graph: ${normalized}`);
  }

  const dependencies = Array.from(context.graph.get(normalized) || []).sort();
  const dependents = Array.from(context.reverseGraph.get(normalized) || []).sort();
  console.log(formatFocusReport({ file: normalized, dependencies, dependents }));
}

function askQuestion(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function handleInteractive(options) {
  const repoRoot = await getRepoRoot(options.repo || process.cwd());
  const context = await buildAnalysisContext(repoRoot, options);
  console.log("Select file to analyze (type full relative path):");
  context.sourceFiles.slice(0, 30).forEach((file) => console.log(`- ${file}`));

  const answer = (await askQuestion("> ")).trim();
  if (!answer) {
    throw new Error("No file selected.");
  }

  let report = await createImpactReport({
    repoRoot,
    mode: "simulation",
    context,
    seedFiles: [answer],
    changedFilesDetected: 1,
    options
  });
  report = await maybeRecordForecast(report, repoRoot, context, options);
  await emitReport(report, context, repoRoot, options);
}

async function handleMetrics(options) {
  const repoRoot = await getRepoRoot(options.repo || process.cwd());
  const config = await loadConfig(repoRoot);
  const payload = await loadMetricsSummary(repoRoot, config.validation);
  const output = normalizeOutputMode(options.output);

  if (output.mode === "cli" || output.mode === "both") {
    console.log(formatMetricsSummary(payload));
  }
  if (output.mode === "json" || output.mode === "both") {
    console.log(JSON.stringify(payload, null, 2));
  }
}

function addSharedImpactOptions(command) {
  return command
    .option("--repo <path>", "Path inside the target repository", process.cwd())
    .option("--output <mode>", "Output mode: cli | json | both", "cli")
    .option("--report-file <file>", "Write report JSON to this path")
    .option("--export [dir]", "Export impact.json and graph.json (default: output)")
    .option("--why", "Show path-based impact explanations", false)
    .option("--code", "Show dependency code lines responsible for propagation", false)
    .option("--max-depth <n>", "Depth limit for reverse traversal")
    .option("--depth <n>", "Alias for --max-depth")
    .option("--risk <levels>", "Filter by risk: HIGH|MEDIUM|LOW (comma-separated)")
    .option("--fast", "Skip centrality in scoring for faster execution", false)
    .option("--record-forecast", "Store this run for future validation", false)
    .option(
      "--validate-latest",
      "Compare this run against the latest recorded forecast",
      false
    )
    .option("--ci", "Enable CI policy gates (non-zero exit on violation)", false)
    .option("--ci-threshold <risk>", "Risk threshold for CI gate override")
    .option("--no-cache", "Disable incremental parser cache")
    .option("--cache-file <path>", "Cache file path override");
}

async function run() {
  const program = new Command();

  program
    .name("impact-analyzer")
    .description(
      "Developer-first impact analyzer for diff-based and simulated code change analysis"
    )
    .version("3.0.0");

  addSharedImpactOptions(
    program
      .command("analyze")
      .description("Analyze actual changes from Git diff/staged/commit range")
      .option("--commit <ref>", "Commit hash or range (e.g. HEAD~2..HEAD)")
      .option("--staged", "Analyze staged changes")
  ).action(async (options) => {
    await handleAnalyze(options);
  });

  addSharedImpactOptions(
    program
      .command("check [files...]")
      .description("Simulate impact of hypothetical changes without editing code")
      .option("--targets <csv>", "Additional simulated files as comma-separated list")
      .option("--graph", "Print reverse dependency graph from target files", false)
  ).action(async (files, options) => {
    await handleCheck(files, options);
  });

  program
    .command("graph [file]")
    .description("Print reverse dependency graph (all roots or focused file)")
    .option("--repo <path>", "Path inside the target repository", process.cwd())
    .option("--max-depth <n>", "Depth limit for traversal")
    .option("--depth <n>", "Alias for --max-depth")
    .option("--no-cache", "Disable incremental parser cache")
    .option("--cache-file <path>", "Cache file path override")
    .action(async (file, options) => {
      await handleGraph(file, options);
    });

  program
    .command("focus <file>")
    .description("Show direct dependencies and dependents of one file")
    .option("--repo <path>", "Path inside the target repository", process.cwd())
    .option("--no-cache", "Disable incremental parser cache")
    .option("--cache-file <path>", "Cache file path override")
    .action(async (file, options) => {
      await handleFocus(file, options);
    });

  addSharedImpactOptions(
    program.command("interactive").description("Interactive simulation mode")
  ).action(async (options) => {
    await handleInteractive(options);
  });

  program
    .command("metrics")
    .description("Show validation-loop quality metrics")
    .option("--repo <path>", "Path inside the target repository", process.cwd())
    .option("--output <mode>", "Output mode: cli | json | both", "cli")
    .action(async (options) => {
      await handleMetrics(options);
    });

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    logger.error(error.message);
    process.exitCode = process.exitCode || 1;
  }
}

run();
