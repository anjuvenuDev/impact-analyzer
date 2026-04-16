const fs = require("fs/promises");
const path = require("path");

async function exportJson(payload, destinationPath) {
  const outputPath = path.resolve(destinationPath);
  const outputDir = path.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true });

  const content = JSON.stringify(payload, null, 2);
  await fs.writeFile(outputPath, `${content}\n`, "utf8");
  return outputPath;
}

async function exportImpactReport(report, destinationPath) {
  return exportJson(report, destinationPath);
}

module.exports = {
  exportJson,
  exportImpactReport
};
