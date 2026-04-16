const fs = require("fs/promises");
const path = require("path");

const DEFAULT_EXTENSIONS = new Set([".js", ".ts"]);
const DEFAULT_EXCLUDED_DIRS = new Set(["node_modules", ".git"]);

async function walkDirectory(currentDir, repoRoot, files, options) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && options.excludeDirs.has(entry.name)) {
      continue;
    }

    const absPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      await walkDirectory(absPath, repoRoot, files, options);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const ext = path.extname(entry.name);
    if (!options.extensions.has(ext)) {
      continue;
    }

    const relativePath = path.relative(repoRoot, absPath).replace(/\\/g, "/");
    files.push(relativePath);
  }
}

async function scanSourceFiles(repoRoot, options = {}) {
  const files = [];
  const normalizedExtensions = options.extensions
    ? new Set(options.extensions)
    : DEFAULT_EXTENSIONS;
  const normalizedExcludeDirs = options.excludeDirs
    ? new Set(options.excludeDirs)
    : DEFAULT_EXCLUDED_DIRS;

  await walkDirectory(repoRoot, repoRoot, files, {
    extensions: normalizedExtensions,
    excludeDirs: normalizedExcludeDirs
  });
  files.sort();
  return files;
}

module.exports = {
  scanSourceFiles
};
