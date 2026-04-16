const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

function normalizeRepoPath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

async function runGit(args, repoRoot) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repoRoot,
    maxBuffer: 10 * 1024 * 1024
  });
  return stdout.trim();
}

function isCommitRange(value) {
  return typeof value === "string" && value.includes("..");
}

async function getRepoRoot(startPath = process.cwd()) {
  const root = await runGit(["rev-parse", "--show-toplevel"], startPath);
  return root;
}

function parseLines(rawOutput) {
  if (!rawOutput) {
    return [];
  }

  const unique = new Set();
  for (const line of rawOutput.split("\n")) {
    const value = line.trim();
    if (value) {
      unique.add(normalizeRepoPath(value));
    }
  }

  return Array.from(unique);
}

async function getChangedFiles({ repoRoot, commit, staged } = {}) {
  const root = repoRoot || (await getRepoRoot());
  let primaryArgs;
  if (staged) {
    primaryArgs = ["diff", "--name-only", "--cached"];
  } else if (commit) {
    primaryArgs = isCommitRange(commit)
      ? ["diff", "--name-only", commit]
      : ["diff", "--name-only", `${commit}~1`, commit];
  } else {
    primaryArgs = ["diff", "--name-only", "HEAD~1", "HEAD"];
  }

  try {
    const raw = await runGit(primaryArgs, root);
    return parseLines(raw);
  } catch (primaryError) {
    if (commit || staged) {
      throw primaryError;
    }

    const fallbackRaw = await runGit(
      ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"],
      root
    );
    return parseLines(fallbackRaw);
  }
}

module.exports = {
  getRepoRoot,
  getChangedFiles,
  runGit,
  isCommitRange,
  normalizeRepoPath
};
