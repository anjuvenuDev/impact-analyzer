let babelParser = null;
try {
  babelParser = require("@babel/parser");
} catch (_error) {
  babelParser = null;
}

const IMPORT_FROM_REGEX =
  /import\s+(?:[\w*\s{},]*\s+from\s+)?["']([^"']+)["']/g;
const REQUIRE_REGEX = /require\(\s*["']([^"']+)["']\s*\)/g;
const DYNAMIC_IMPORT_REGEX = /import\(\s*["']([^"']+)["']\s*\)/g;
const BARE_IMPORT_REGEX = /import\s+["']([^"']+)["']/g;

function walkAst(node, visitor) {
  if (!node || typeof node !== "object") {
    return;
  }

  visitor(node);

  if (Array.isArray(node)) {
    for (const child of node) {
      walkAst(child, visitor);
    }
    return;
  }

  for (const value of Object.values(node)) {
    if (!value || typeof value !== "object") {
      continue;
    }
    walkAst(value, visitor);
  }
}

function parseWithBabel(sourceCode) {
  if (!babelParser) {
    return null;
  }

  return babelParser.parse(sourceCode, {
    sourceType: "unambiguous",
    allowReturnOutsideFunction: true,
    plugins: [
      "typescript",
      "jsx",
      "dynamicImport",
      "importAttributes",
      "classProperties",
      "decorators-legacy"
    ]
  });
}

function extractFromAst(sourceCode) {
  const ast = parseWithBabel(sourceCode);
  if (!ast) {
    return null;
  }

  const lines = sourceCode.split("\n");
  const results = [];

  function pushSpecifier(specifier, lineNumber) {
    if (typeof specifier !== "string") {
      return;
    }
    const line = lineNumber || 1;
    results.push({
      specifier,
      line,
      text: (lines[line - 1] || "").trim()
    });
  }

  walkAst(ast.program, (node) => {
    if (node.type === "ImportDeclaration" && node.source) {
      pushSpecifier(node.source.value, node.loc && node.loc.start.line);
      return;
    }

    if (
      (node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") &&
      node.source
    ) {
      pushSpecifier(node.source.value, node.loc && node.loc.start.line);
      return;
    }

    if (node.type === "ImportExpression" && node.source && node.source.type === "StringLiteral") {
      pushSpecifier(node.source.value, node.loc && node.loc.start.line);
      return;
    }

    if (node.type === "TSImportType" && node.argument && node.argument.type === "TSLiteralType") {
      const literal = node.argument.literal;
      if (literal && literal.type === "StringLiteral") {
        pushSpecifier(literal.value, node.loc && node.loc.start.line);
      }
      return;
    }

    if (node.type !== "CallExpression") {
      return;
    }

    const firstArg = node.arguments && node.arguments[0];
    if (!firstArg || firstArg.type !== "StringLiteral") {
      return;
    }

    if (node.callee && node.callee.type === "Identifier" && node.callee.name === "require") {
      pushSpecifier(firstArg.value, node.loc && node.loc.start.line);
      return;
    }

    if (node.callee && node.callee.type === "Import") {
      pushSpecifier(firstArg.value, node.loc && node.loc.start.line);
    }
  });

  return results;
}

function extractWithRegex(sourceCode) {
  const lines = sourceCode.split("\n");
  const regexes = [
    IMPORT_FROM_REGEX,
    REQUIRE_REGEX,
    DYNAMIC_IMPORT_REGEX,
    BARE_IMPORT_REGEX
  ];
  const output = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const regex of regexes) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(line)) !== null) {
        output.push({
          specifier: match[1],
          line: i + 1,
          text: line.trim()
        });
      }
    }
  }

  return output;
}

function extractDependencySpecifiers(sourceCode) {
  try {
    const astOutput = extractFromAst(sourceCode);
    if (astOutput) {
      return astOutput;
    }
  } catch (_error) {
    // fall back to regex parsing
  }
  return extractWithRegex(sourceCode);
}

module.exports = {
  extractDependencySpecifiers
};
