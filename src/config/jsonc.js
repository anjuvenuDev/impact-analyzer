function stripJsonComments(input) {
  let output = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < input.length; i += 1) {
    const current = input[i];
    const next = input[i + 1];

    if (inLineComment) {
      if (current === "\n") {
        inLineComment = false;
        output += current;
      }
      continue;
    }

    if (inBlockComment) {
      if (current === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inString) {
      output += current;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === "\"") {
        inString = false;
      }
      continue;
    }

    if (current === "\"") {
      inString = true;
      output += current;
      continue;
    }

    if (current === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (current === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }

    output += current;
  }

  return output;
}

function parseJsonc(rawText) {
  try {
    return JSON.parse(rawText);
  } catch (_error) {
    const cleaned = stripJsonComments(rawText);
    return JSON.parse(cleaned);
  }
}

module.exports = {
  stripJsonComments,
  parseJsonc
};
