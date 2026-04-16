const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { parseJsonc } = require("../config/jsonc");

function toPosix(value) {
  return value.replace(/\\/g, "/");
}

function normalizeRelative(value) {
  return toPosix(value).replace(/^\.\//, "");
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

function mergeCompilerConfigs(baseConfig, overrideConfig) {
  const baseOptions = baseConfig.compilerOptions || {};
  const overrideOptions = overrideConfig.compilerOptions || {};

  const merged = {
    ...baseConfig,
    ...overrideConfig,
    compilerOptions: {
      ...baseOptions,
      ...overrideOptions,
      paths: {
        ...(baseOptions.paths || {}),
        ...(overrideOptions.paths || {})
      }
    }
  };

  return merged;
}

async function readCompilerConfig(configPath, visited = new Set()) {
  if (visited.has(configPath)) {
    return {};
  }
  visited.add(configPath);

  const raw = await fs.readFile(configPath, "utf8");
  const parsed = parseJsonc(raw);
  const extendsRef = parsed.extends;

  let base = {};
  if (typeof extendsRef === "string") {
    const localBasePath = extendsRef.startsWith(".")
      ? path.resolve(path.dirname(configPath), extendsRef)
      : null;

    if (localBasePath) {
      const withJson = localBasePath.endsWith(".json")
        ? localBasePath
        : `${localBasePath}.json`;
      if (await pathExists(withJson)) {
        base = await readCompilerConfig(withJson, visited);
      } else if (await pathExists(localBasePath)) {
        base = await readCompilerConfig(localBasePath, visited);
      }
    }
  }

  return mergeCompilerConfigs(base, parsed);
}

async function detectCompilerConfig(repoRoot) {
  const tsconfig = path.join(repoRoot, "tsconfig.json");
  const jsconfig = path.join(repoRoot, "jsconfig.json");

  if (await pathExists(tsconfig)) {
    return { path: tsconfig, config: await readCompilerConfig(tsconfig) };
  }
  if (await pathExists(jsconfig)) {
    return { path: jsconfig, config: await readCompilerConfig(jsconfig) };
  }
  return null;
}

function compilePathAliases(repoRoot, compilerInfo) {
  if (!compilerInfo) {
    return [];
  }

  const configDir = path.dirname(compilerInfo.path);
  const compilerOptions = compilerInfo.config.compilerOptions || {};
  const baseUrlValue = compilerOptions.baseUrl || ".";
  const baseUrlAbsolute = path.resolve(configDir, baseUrlValue);
  const baseUrlRelative = normalizeRelative(path.relative(repoRoot, baseUrlAbsolute));
  const paths = compilerOptions.paths || {};

  const aliases = [];
  for (const [pattern, targets] of Object.entries(paths)) {
    if (!Array.isArray(targets) || targets.length === 0) {
      continue;
    }

    aliases.push({
      pattern,
      targets: targets.map((target) => {
        const absoluteTarget = path.resolve(baseUrlAbsolute, target);
        return normalizeRelative(path.relative(repoRoot, absoluteTarget));
      }),
      baseUrlRelative
    });
  }

  return aliases;
}

function matchAliasPattern(pattern, specifier) {
  if (!pattern.includes("*")) {
    return pattern === specifier ? [""] : null;
  }

  const firstStar = pattern.indexOf("*");
  const prefix = pattern.slice(0, firstStar);
  const suffix = pattern.slice(firstStar + 1);
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) {
    return null;
  }
  const wildcard = specifier.slice(prefix.length, specifier.length - suffix.length);
  return [wildcard];
}

function applyAliasTarget(targetPattern, wildcards) {
  if (!targetPattern.includes("*")) {
    return targetPattern;
  }

  let output = targetPattern;
  for (const wildcard of wildcards) {
    output = output.replace("*", wildcard);
  }
  return output;
}

async function expandWorkspacePattern(repoRoot, pattern) {
  const normalized = toPosix(pattern).replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  const results = [];

  async function walk(currentAbsolute, index) {
    if (index >= segments.length) {
      results.push(currentAbsolute);
      return;
    }

    const segment = segments[index];
    if (segment !== "*") {
      const next = path.join(currentAbsolute, segment);
      if (await pathExists(next)) {
        await walk(next, index + 1);
      }
      return;
    }

    let entries = [];
    try {
      entries = await fs.readdir(currentAbsolute, { withFileTypes: true });
    } catch (_error) {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      await walk(path.join(currentAbsolute, entry.name), index + 1);
    }
  }

  await walk(repoRoot, 0);
  return results;
}

async function loadWorkspacePackages(repoRoot) {
  const packageJsonPath = path.join(repoRoot, "package.json");
  if (!(await pathExists(packageJsonPath))) {
    return [];
  }

  let packageJson;
  try {
    const raw = await fs.readFile(packageJsonPath, "utf8");
    packageJson = JSON.parse(raw);
  } catch (_error) {
    return [];
  }

  let workspacePatterns = [];
  if (Array.isArray(packageJson.workspaces)) {
    workspacePatterns = packageJson.workspaces;
  } else if (
    packageJson.workspaces &&
    Array.isArray(packageJson.workspaces.packages)
  ) {
    workspacePatterns = packageJson.workspaces.packages;
  }

  const workspaceDirs = new Set();
  for (const pattern of workspacePatterns) {
    const resolved = await expandWorkspacePattern(repoRoot, pattern);
    for (const dir of resolved) {
      workspaceDirs.add(dir);
    }
  }

  const packages = [];
  for (const dir of workspaceDirs) {
    const pkgPath = path.join(dir, "package.json");
    if (!(await pathExists(pkgPath))) {
      continue;
    }
    try {
      const raw = await fs.readFile(pkgPath, "utf8");
      const pkg = JSON.parse(raw);
      if (!pkg.name) {
        continue;
      }
      packages.push({
        name: pkg.name,
        dir: normalizeRelative(path.relative(repoRoot, dir))
      });
    } catch (_error) {
      continue;
    }
  }

  packages.sort((a, b) => a.name.localeCompare(b.name));
  return packages;
}

function buildResolverFingerprint({ aliases, workspacePackages, extensions }) {
  const payload = JSON.stringify({
    aliases,
    workspacePackages,
    extensions
  });
  return crypto.createHash("sha1").update(payload).digest("hex");
}

function resolveFromBase(base, knownFiles, extensions) {
  const normalized = normalizeRelative(path.posix.normalize(base));
  const candidates = [normalized];
  for (const ext of extensions) {
    candidates.push(`${normalized}${ext}`);
  }
  for (const ext of extensions) {
    candidates.push(path.posix.join(normalized, `index${ext}`));
  }

  for (const candidate of candidates) {
    if (knownFiles.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveWithAliases(specifier, context) {
  const candidates = [];
  for (const alias of context.aliases) {
    const wildcards = matchAliasPattern(alias.pattern, specifier);
    if (!wildcards) {
      continue;
    }
    for (const target of alias.targets) {
      candidates.push(applyAliasTarget(target, wildcards));
    }
  }
  return candidates;
}

function resolveWithWorkspace(specifier, context) {
  const candidates = [];
  for (const pkg of context.workspacePackages) {
    if (specifier === pkg.name) {
      candidates.push(pkg.dir);
      candidates.push(path.posix.join(pkg.dir, "src"));
      continue;
    }
    if (specifier.startsWith(`${pkg.name}/`)) {
      const suffix = specifier.slice(pkg.name.length + 1);
      candidates.push(path.posix.join(pkg.dir, suffix));
      candidates.push(path.posix.join(pkg.dir, "src", suffix));
      candidates.push(path.posix.join(pkg.dir, "lib", suffix));
    }
  }
  return candidates;
}

function resolveDependencySpecifier(fromFile, specifier, context) {
  const fromDir = path.posix.dirname(toPosix(fromFile));
  const candidateBases = [];

  if (specifier.startsWith(".")) {
    candidateBases.push(path.posix.join(fromDir, specifier));
  } else if (specifier.startsWith("/")) {
    candidateBases.push(specifier.slice(1));
  } else {
    candidateBases.push(...resolveWithAliases(specifier, context));
    candidateBases.push(...resolveWithWorkspace(specifier, context));
  }

  const deduped = Array.from(
    new Set(candidateBases.map((value) => normalizeRelative(value)))
  );

  for (const base of deduped) {
    const resolved = resolveFromBase(base, context.knownFiles, context.extensions);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

async function buildResolutionContext(repoRoot, knownFiles, extensions) {
  const compilerInfo = await detectCompilerConfig(repoRoot);
  const aliases = compilePathAliases(repoRoot, compilerInfo);
  const workspacePackages = await loadWorkspacePackages(repoRoot);

  const context = {
    repoRoot,
    extensions,
    knownFiles,
    aliases,
    workspacePackages
  };

  return {
    ...context,
    fingerprint: buildResolverFingerprint({
      aliases,
      workspacePackages,
      extensions
    })
  };
}

module.exports = {
  buildResolutionContext,
  resolveDependencySpecifier,
  detectCompilerConfig,
  loadWorkspacePackages
};
