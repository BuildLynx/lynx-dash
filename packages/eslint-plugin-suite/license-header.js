// SPDX-License-Identifier: MPL-2.0

// MPL-2.0 license header check for Lynx Dash.
// Requires SPDX-License-Identifier only (no copyright holder line).

const ALLOWED_PREFIX_LINES = ["/** @jest-environment jsdom */"];

const HEADER_REGEX =
  /^(?:\/\/ SPDX-FileCopyrightText:[^\n]*\r?\n)?\/\/ SPDX-License-Identifier: ([^\n\r]+)\r?(?:\n|$)/;

/** @param {string} fullText */
function findHeader(fullText) {
  let offset = 0;
  const lines = fullText.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "") {
      offset += lines[i].length + 1;
      continue;
    }
    if (ALLOWED_PREFIX_LINES.includes(trimmed)) {
      offset += lines[i].length + 1;
      continue;
    }
    break;
  }

  const rest = fullText.slice(offset);
  const match = rest.match(HEADER_REGEX);
  if (!match) {
    return {
      match: undefined,
      headerStartIndex: -1,
      headerEndIndex: -1,
      preHeaderText: fullText.slice(0, offset).trim(),
    };
  }

  return {
    match,
    headerStartIndex: offset + match.index,
    headerEndIndex: offset + match.index + match[0].length,
    preHeaderText: fullText.slice(0, offset).trim(),
  };
}

/** @type {import("eslint").Rule.RuleModule} */
module.exports = {
  meta: {
    type: "suggestion",
    fixable: "code",
    schema: [
      {
        type: "object",
        properties: {
          licenseType: {
            type: "string",
            description: "SPDX license identifier required in the file header.",
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      wrongHeaderError:
        "There is an error with the file header. Expected `// SPDX-License-Identifier: <licenseType>` at the top of the file.",
      missingTypeOfLicenseError:
        "Specify licenseType in the ESLint rule options (e.g. { licenseType: \"MPL-2.0\" }).",
      prefixLinesError:
        "There are lines before the header that are not allowed. Move them below the license header.",
    },
  },

  create: (context) => {
    const options = context.options[0];
    if (!options?.licenseType) {
      context.report({
        loc: { line: 0, column: 0 },
        messageId: "missingTypeOfLicenseError",
      });
      return {};
    }

    const licenseType = options.licenseType;
    const expectedHeader = `// SPDX-License-Identifier: ${licenseType}`;

    return {
      Program: (node) => {
        const fullText = context.sourceCode.getText();
        const { match, headerStartIndex, headerEndIndex, preHeaderText } = findHeader(fullText);

        const prefixLines = preHeaderText.split("\n").filter(Boolean);
        const prefixLinesAreValid = prefixLines.every((line) =>
          ALLOWED_PREFIX_LINES.includes(line.trim()),
        );

        const isHeaderCorrect = match != undefined && match[1] === licenseType;

        if (!prefixLinesAreValid) {
          context.report({
            node,
            messageId: "prefixLinesError",
            fix: (fixer) => {
              const fixes = [];
              if (match) {
                fixes.push(fixer.removeRange([headerStartIndex, headerEndIndex]));
              }
              fixes.push(fixer.insertTextBeforeRange([0, 0], `${expectedHeader}\n\n`));
              return fixes;
            },
          });
          return;
        }

        if (!isHeaderCorrect) {
          context.report({
            node,
            messageId: "wrongHeaderError",
            fix: (fixer) => {
              if (match) {
                return fixer.replaceTextRange([headerStartIndex, headerEndIndex], `${expectedHeader}\n`);
              }
              return fixer.insertTextBeforeRange([0, 0], `${expectedHeader}\n\n`);
            },
          });
        }
      },
    };
  },
};
