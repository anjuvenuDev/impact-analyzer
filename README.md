# Code Impact Analyzer

Developer-first CLI to predict blast radius from real diffs or simulated file changes.

It builds a dependency graph, traverses reverse dependencies, scores impacted files, and explains why each file is affected.

## Features

- Diff-aware analysis (`HEAD~1`, staged, commit range)
- Simulation mode before making changes (`check`)
- Impact scoring with risk levels (`HIGH`, `MEDIUM`, `LOW`)
- Explainability (`--why`) and source-line insights (`--code`)
- Policy gates for CI (`criticalPaths`, risk threshold, owners)
- Incremental cache for faster repeated runs
- Forecast/validation loop with precision/recall/F1 metrics

## Install

```bash
npm install
```

## Quickstart

```bash
# Simulate impact before editing code
impact-analyzer check src/auth.ts --why

# Analyze actual repo changes
impact-analyzer analyze --staged --why

# Export machine-readable artifacts
impact-analyzer analyze --export output --output both
```

## Commands

```bash
impact-analyzer analyze [--commit <ref> | --staged] [options]
impact-analyzer check <file...> [--targets <csv>] [options]
impact-analyzer graph [file] [--depth <n>]
impact-analyzer focus <file>
impact-analyzer interactive
impact-analyzer metrics
```

Common options:

- `--output cli|json|both`
- `--report-file <path>`
- `--export [dir]`
- `--why`
- `--code`
- `--depth <n>` / `--max-depth <n>`
- `--risk HIGH|MEDIUM|LOW`
- `--fast`
- `--record-forecast`
- `--validate-latest`
- `--ci`
- `--ci-threshold <risk>`
- `--no-cache`
- `--cache-file <path>`

## Config

Create `impact.config.json` in target repo root:

```json
{
  "ignore": ["node_modules", ".git", "tests"],
  "extensions": [".js", ".ts", ".jsx", ".tsx"],
  "cache": {
    "enabled": true,
    "file": ".impact-cache.json"
  },
  "policies": {
    "criticalPaths": ["src/payments/**", "src/auth/**"],
    "owners": {
      "src/auth/**": "@security-team",
      "src/**": "@app-team"
    },
    "ci": {
      "failOnRisk": "HIGH",
      "failOnCritical": true
    }
  },
  "validation": {
    "forecastsFile": ".impact-forecasts.jsonl",
    "metricsFile": ".impact-validation.jsonl"
  }
}
```

## Create Repo and Push

```bash
cd /home/anj/impact-analyzer
git init
git add .
git commit -m "feat: production-ready code impact analyzer"
git branch -M main
git remote add origin <YOUR_GITHUB_REPO_URL>
git push -u origin main
```

## Deployment

### CI

`/.github/workflows/ci.yml` runs:

- dependency install
- syntax check
- smoke test
- package dry-run

### NPM Publish

`/.github/workflows/publish-npm.yml` publishes on GitHub Release or manual dispatch.

Required GitHub repo secret:

- `NPM_TOKEN` (from npm access token)

Optional release flow:

```bash
npm version patch
git push --follow-tags
# create GitHub Release for the new tag
```

## Architecture

- `src/cli`: command orchestration
- `src/git`: git integration
- `src/scanner`: file discovery
- `src/resolution`: ts/js alias + workspace resolver
- `src/parser`: AST-first dependency extraction
- `src/cache`: incremental parse cache
- `src/graph`: dependency and reverse graph
- `src/analysis`: impact traversal + scoring
- `src/policy`: ownership and CI policy evaluation
- `src/metrics`: forecast validation metrics
- `src/output`: CLI and JSON formatting

## License

MIT
