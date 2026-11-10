const TOOL_ALIASES = {
  Read: "read",
  Grep: "search",
  Glob: "search",
  Bash: "execute",
  Edit: "edit",
  MultiEdit: "edit",
  Write: "edit",
  NotebookEdit: "edit",
  WebFetch: "web",
  WebSearch: "web",
  Task: "agent",
  TodoWrite: "todo",
};

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/;
const ALWAYS_USE = /MUST BE USED|PROACTIVELY|\bUse proactively\b/;

function parseFields(block) {
  const fields = Object.create(null);
  let key = null;
  for (const line of block.split(/\r?\n/)) {
    const m = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(line);
    if (m) {
      key = m[1];
      fields[key] = [m[2]];
    } else if (key) {
      fields[key].push(line.trim());
    }
  }
  return fields;
}

function cleanDescription(lines) {
  const folded = /^[>|][+-]?$/.test(lines[0].trim());
  const raw = (folded ? lines.slice(1) : lines).join(" ").replace(/\s+/g, " ").trim();
  const text = raw.replace(/^(["'])(.*)\1$/, "$2");
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])/).filter((s) => !ALWAYS_USE.test(s));
  return JSON.stringify(sentences.length ? sentences.join(" ") : text);
}

function mapTools(lines) {
  const names = lines.join(" ").replace(/[[\]"']/g, "").split(/[,\s]+/).filter(Boolean);
  return [...new Set(names.filter((n) => Object.hasOwn(TOOL_ALIASES, n)).map((n) => TOOL_ALIASES[n]))];
}

export function convertAgent(markdown, name) {
  const source = markdown.replace(/^\uFEFF/, "");
  const m = FRONTMATTER.exec(source);
  if (!m) throw new Error(`agent ${name} has no frontmatter`);
  const fields = parseFields(m[1]);
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const out = ["---", `name: ${name}`];
  if (fields.description) out.push(`description: ${cleanDescription(fields.description)}`);
  if (fields.tools) {
    const mapped = mapTools(fields.tools);
    const tools = mapped.length ? mapped : ["read", "search"];
    out.push(`tools: [${tools.map((t) => `'${t}'`).join(", ")}]`);
  }
  out.push("---");
  return out.join(eol) + eol + m[2];
}
