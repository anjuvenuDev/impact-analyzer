let chalk;
try {
  chalk = require("chalk");
} catch (_error) {
  chalk = {
    red: (value) => value,
    yellow: (value) => value,
    green: (value) => value,
    cyan: (value) => value,
    bold: (value) => value
  };
}

function riskStyle(risk) {
  if (risk === "HIGH") {
    return chalk.red;
  }
  if (risk === "MEDIUM") {
    return chalk.yellow;
  }
  return chalk.green;
}

function riskBadge(risk) {
  const emoji = risk === "HIGH" ? "🔴" : risk === "MEDIUM" ? "🟡" : "🟢";
  return `${emoji} ${risk}`;
}

function formatImpactRows(rows) {
  const includeOwner = rows.some((row) => row.owner);
  const includeCritical = rows.some((row) => row.critical !== undefined);
  const headers = ["File", "Score", "Risk", "Depth", "Dependents"];
  if (includeCritical) {
    headers.push("Critical");
  }
  if (includeOwner) {
    headers.push("Owner");
  }

  const widths = {
    file: Math.max(headers[0].length, ...rows.map((row) => row.file.length)),
    score: Math.max(headers[1].length, ...rows.map((row) => String(row.score).length)),
    risk: Math.max(
      headers[2].length,
      ...rows.map((row) => riskBadge(row.risk).length)
    ),
    depth: Math.max(headers[3].length, ...rows.map((row) => String(row.depth).length)),
    dependents: Math.max(
      headers[4].length,
      ...rows.map((row) => String(row.dependents).length)
    ),
    critical: includeCritical
      ? Math.max("Critical".length, ...rows.map((row) => (row.critical ? "yes" : "no").length))
      : 0,
    owner: includeOwner
      ? Math.max("Owner".length, ...rows.map((row) => (row.owner || "-").length))
      : 0
  };

  let headerLine = `${headers[0].padEnd(widths.file)}  ${headers[1].padEnd(
    widths.score
  )}  ${headers[2].padEnd(widths.risk)}  ${headers[3].padEnd(
    widths.depth
  )}  ${headers[4].padEnd(widths.dependents)}`;
  let separator = `${"-".repeat(widths.file)}  ${"-".repeat(
    widths.score
  )}  ${"-".repeat(widths.risk)}  ${"-".repeat(widths.depth)}  ${"-".repeat(
    widths.dependents
  )}`;
  if (includeCritical) {
    headerLine += `  ${"Critical".padEnd(widths.critical)}`;
    separator += `  ${"-".repeat(widths.critical)}`;
  }
  if (includeOwner) {
    headerLine += `  ${"Owner".padEnd(widths.owner)}`;
    separator += `  ${"-".repeat(widths.owner)}`;
  }

  const body = rows.map((row) => {
    const badge = riskBadge(row.risk);
    const styledBadge = riskStyle(row.risk)(badge);
    let line = `${row.file.padEnd(widths.file)}  ${String(row.score).padEnd(
      widths.score
    )}  ${styledBadge.padEnd(widths.risk)}  ${String(row.depth).padEnd(
      widths.depth
    )}  ${String(row.dependents).padEnd(widths.dependents)}`;
    if (includeCritical) {
      line += `  ${(row.critical ? "yes" : "no").padEnd(widths.critical)}`;
    }
    if (includeOwner) {
      line += `  ${(row.owner || "-").padEnd(widths.owner)}`;
    }
    return line;
  });

  return [headerLine, separator, ...body].join("\n");
}

function formatReason(pathToSeed) {
  if (!pathToSeed || pathToSeed.length <= 1) {
    return "directly changed";
  }
  return pathToSeed.join(" -> ");
}

function formatImpactReport(report, options = {}) {
  const lines = [];
  const modeLabel =
    report.mode === "simulation" ? "Simulating changes..." : "Analyzing changes...";
  lines.push(chalk.cyan(`🔍 ${modeLabel}`));
  lines.push("");

  lines.push(chalk.bold("Changed Files:"));
  if (report.changed.length === 0) {
    lines.push("  (none)");
  } else {
    for (const file of report.changed) {
      lines.push(`  - ${file}`);
    }
  }

  lines.push("");
  lines.push(chalk.bold("Impacted Files:"));
  if (report.impacted.length === 0) {
    lines.push("  (none)");
  } else {
    lines.push(formatImpactRows(report.impacted));
  }

  if (options.why && report.impacted.length > 0) {
    lines.push("");
    lines.push(chalk.bold("Why:"));
    for (const item of report.impacted) {
      lines.push(`${item.file}: ${formatReason(item.pathToSeed)}`);
    }
  }

  if (options.code && report.codeInsights && report.codeInsights.length > 0) {
    lines.push("");
    lines.push(chalk.bold("Code Insights:"));
    for (const insight of report.codeInsights) {
      lines.push(`${insight.file}:${insight.line}  ${insight.text}`);
    }
  }

  if (report.policyViolations && report.policyViolations.length > 0) {
    lines.push("");
    lines.push(chalk.bold("Policy Violations:"));
    for (const violation of report.policyViolations) {
      if (violation.type === "risk_threshold") {
        lines.push(
          `risk >= ${violation.threshold}: ${violation.files.join(", ")}`
        );
      } else if (violation.type === "critical_paths") {
        lines.push(`critical paths impacted: ${violation.files.join(", ")}`);
      } else {
        lines.push(JSON.stringify(violation));
      }
    }
  }

  return lines.join("\n");
}

function formatFocusReport(report) {
  const lines = [];
  lines.push(chalk.bold(`Dependencies of ${report.file}:`));
  if (report.dependencies.length === 0) {
    lines.push("  (none)");
  } else {
    for (const value of report.dependencies) {
      lines.push(`  - ${value}`);
    }
  }
  lines.push("");
  lines.push(chalk.bold("Dependents:"));
  if (report.dependents.length === 0) {
    lines.push("  (none)");
  } else {
    for (const value of report.dependents) {
      lines.push(`  - ${value}`);
    }
  }
  return lines.join("\n");
}

function formatMetricsSummary(summaryPayload) {
  const { summary } = summaryPayload;
  const lines = [];
  lines.push(chalk.bold("Validation Metrics"));
  lines.push(`runs: ${summary.runs}`);
  lines.push(`avg precision: ${summary.avgPrecision ?? "n/a"}`);
  lines.push(`avg recall: ${summary.avgRecall ?? "n/a"}`);
  lines.push(`avg f1: ${summary.avgF1 ?? "n/a"}`);
  return lines.join("\n");
}

module.exports = {
  formatImpactReport,
  formatFocusReport,
  formatMetricsSummary
};
