function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function sanitizeUrl(value) {
  const url = String(value || "").trim();

  if (!url) {
    return "";
  }

  if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(url)) {
    return url;
  }

  return "";
}

function renderInline(value) {
  const tokens = [];
  let text = String(value || "");

  const stash = (html) => {
    const token = `\uE000${tokens.length}\uE001`;
    tokens.push(html);
    return token;
  };

  text = text.replace(/`([^`\n]+)`/g, (_, code) => stash(`<code>${escapeHtml(code)}</code>`));
  text = text.replace(/\\([\\`*_[\]{}()#+\-.!>])/g, (_, character) => stash(escapeHtml(character)));
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g, (_, label, href) => {
    const safeHref = sanitizeUrl(href);
    const renderedLabel = renderInline(label);

    if (!safeHref) {
      return stash(renderedLabel);
    }

    return stash(`<a href="${escapeAttribute(safeHref)}" target="_blank" rel="noopener noreferrer">${renderedLabel}</a>`);
  });

  text = escapeHtml(text);
  text = text.replace(/~~([^\n]+?)~~/g, "<del>$1</del>");
  text = text.replace(/\*\*([^\n]+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^\n]+?)__/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>");
  text = text.replace(/(^|[^_])_([^_\n]+?)_(?!_)/g, "$1<em>$2</em>");
  text = text.replace(/\uE000(\d+)\uE001/g, (_, index) => tokens[Number(index)] || "");

  return text;
}

function getIndent(line) {
  const match = String(line).match(/^[\t ]*/);
  return (match ? match[0] : "").replaceAll("\t", "    ").length;
}

function getListItem(line) {
  const match = String(line).match(/^(\s*)([-+*]|\d+[.)])\s+(.+)$/);

  if (!match) {
    return null;
  }

  return {
    indent: match[1].replaceAll("\t", "    ").length,
    type: /^\d/.test(match[2]) ? "ol" : "ul",
    start: /^\d/.test(match[2]) ? Number.parseInt(match[2], 10) : null,
    text: match[3]
  };
}

function renderListItemContent(value) {
  const task = String(value).match(/^\[([ xX])\]\s+(.+)$/);

  if (!task) {
    return renderInline(value).replaceAll("\n", "<br>");
  }

  const checked = task[1].toLowerCase() === "x";
  return `<span class="markdown-task"><input type="checkbox" disabled${checked ? " checked" : ""}><span>${renderInline(task[2]).replaceAll("\n", "<br>")}</span></span>`;
}

function renderList(lines, startIndex, baseIndent, type) {
  const firstItem = getListItem(lines[startIndex]);
  const startAttribute = type === "ol" && firstItem && firstItem.start !== 1 ? ` start="${firstItem.start}"` : "";
  let html = `<${type}${startAttribute}>`;
  let index = startIndex;

  while (index < lines.length) {
    const item = getListItem(lines[index]);

    if (!item || item.indent !== baseIndent || item.type !== type) {
      break;
    }

    const itemLines = [item.text];
    let nestedHtml = "";
    index += 1;

    while (index < lines.length) {
      const line = lines[index];
      const nestedItem = getListItem(line);

      if (!line.trim()) {
        const nextItem = getListItem(lines[index + 1] || "");

        if (nextItem && nextItem.indent === baseIndent && nextItem.type === type) {
          index += 1;
        }

        break;
      }

      if (nestedItem) {
        if (nestedItem.indent > baseIndent) {
          const nested = renderList(lines, index, nestedItem.indent, nestedItem.type);
          nestedHtml += nested.html;
          index = nested.nextIndex;
          continue;
        }

        break;
      }

      if (getIndent(line) > baseIndent) {
        itemLines.push(line.trim());
        index += 1;
        continue;
      }

      break;
    }

    html += `<li>${renderListItemContent(itemLines.join("\n"))}${nestedHtml}</li>`;
  }

  html += `</${type}>`;
  return { html, nextIndex: index };
}

function splitTableRow(line) {
  let source = String(line).trim();

  if (source.startsWith("|")) {
    source = source.slice(1);
  }

  if (source.endsWith("|")) {
    source = source.slice(0, -1);
  }

  const cells = [];
  let cell = "";
  let escaped = false;

  for (const character of source) {
    if (escaped) {
      cell += character;
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      cell += character;
      continue;
    }

    if (character === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }

    cell += character;
  }

  cells.push(cell.trim());
  return cells;
}

function getTableAlignments(line) {
  const cells = splitTableRow(line);

  if (cells.length < 2 || !cells.every((cell) => /^:?-{3,}:?$/.test(cell))) {
    return null;
  }

  return cells.map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");

    if (left && right) {
      return "center";
    }

    if (right) {
      return "right";
    }

    if (left) {
      return "left";
    }

    return "";
  });
}

function renderTable(lines, startIndex) {
  const headers = splitTableRow(lines[startIndex]);
  const alignments = getTableAlignments(lines[startIndex + 1]);
  let index = startIndex + 2;
  const rows = [];

  while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
    rows.push(splitTableRow(lines[index]));
    index += 1;
  }

  const headerHtml = headers.map((cell, cellIndex) => {
    const alignment = alignments[cellIndex] ? ` style="text-align: ${alignments[cellIndex]}"` : "";
    return `<th${alignment}>${renderInline(cell)}</th>`;
  }).join("");

  const bodyHtml = rows.map((row) => `<tr>${headers.map((_, cellIndex) => {
    const alignment = alignments[cellIndex] ? ` style="text-align: ${alignments[cellIndex]}"` : "";
    return `<td${alignment}>${renderInline(row[cellIndex] || "")}</td>`;
  }).join("")}</tr>`).join("");

  return {
    html: `<div class="markdown-table-wrap"><table><thead><tr>${headerHtml}</tr></thead>${bodyHtml ? `<tbody>${bodyHtml}</tbody>` : ""}</table></div>`,
    nextIndex: index
  };
}

function isFence(line) {
  return String(line).match(/^\s*(`{3,}|~{3,})\s*([\w-]*)\s*$/);
}

function isHorizontalRule(line) {
  return /^\s*((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})\s*$/.test(String(line));
}

function isBlockStart(lines, index) {
  const line = lines[index] || "";

  if (!line.trim()) {
    return true;
  }

  if (isFence(line) || /^\s*#{1,6}\s+/.test(line) || /^\s*>/.test(line) || getListItem(line) || isHorizontalRule(line)) {
    return true;
  }

  return Boolean(lines[index + 1] && line.includes("|") && getTableAlignments(lines[index + 1]));
}

function renderBlocks(lines) {
  const output = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = isFence(line);

    if (fence) {
      const fenceCharacter = fence[1][0];
      const fenceLength = fence[1].length;
      const language = fence[2] ? ` class="language-${escapeAttribute(fence[2])}"` : "";
      const codeLines = [];
      index += 1;

      while (index < lines.length) {
        const closingFence = lines[index].match(/^\s*(`{3,}|~{3,})\s*$/);

        if (closingFence && closingFence[1][0] === fenceCharacter && closingFence[1].length >= fenceLength) {
          index += 1;
          break;
        }

        codeLines.push(lines[index]);
        index += 1;
      }

      output.push(`<pre><code${language}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    if (index + 1 < lines.length && line.includes("|") && getTableAlignments(lines[index + 1])) {
      const table = renderTable(lines, index);
      output.push(table.html);
      index = table.nextIndex;
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);

    if (heading) {
      const level = heading[1].length;
      output.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (isHorizontalRule(line)) {
      output.push("<hr>");
      index += 1;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quoteLines = [];

      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }

      output.push(`<blockquote>${renderBlocks(quoteLines)}</blockquote>`);
      continue;
    }

    const listItem = getListItem(line);

    if (listItem) {
      const list = renderList(lines, index, listItem.indent, listItem.type);
      output.push(list.html);
      index = list.nextIndex;
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;

    while (index < lines.length && !isBlockStart(lines, index)) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }

    output.push(`<p>${renderInline(paragraphLines.join("\n")).replaceAll("\n", "<br>")}</p>`);
  }

  return output.join("");
}

function renderMarkdown(value) {
  const normalized = String(value || "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  return renderBlocks(normalized.split("\n"));
}

export { renderMarkdown };
