const VALID_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_NAME = 64;
const NAME_LINE = /^(---\r?\n(?:(?!---[ \t]*\r?\n).*\r?\n)*?)name:[ \t]*.*?(\r?\n)/;

export const isValidSkillName = (name) => VALID_NAME.test(name);

export function planInstall(sources) {
  const entries = [];
  const agentEntries = [];
  const warnings = [];
  const ignore = [];

  // Selects items by include list, validates their prefixed name and rejects clashes within one kind.
  function select(kind, source, items, include, toEntry) {
    const found = new Set(items.map((i) => i.name));
    for (const wanted of include ?? []) {
      if (!found.has(wanted)) warnings.push(`${source.id}: "${wanted}" is in the ${kind} include list but not upstream`);
    }
    const keep = include ? new Set(include) : null;
    const out = [];
    for (const item of items) {
      if (keep && !keep.has(item.name)) continue;
      const dest = `${source.prefix}-${item.name}`;
      if (!VALID_NAME.test(dest)) {
        throw new Error(`${source.id}: "${dest}" is not a valid ${kind} name (lowercase letters, digits, hyphens)`);
      }
      if (dest.length > MAX_NAME) {
        throw new Error(`${source.id}: "${dest}" exceeds the ${MAX_NAME}-character ${kind} name limit`);
      }
      out.push(toEntry(item, dest));
    }
    return out;
  }

  const takenBy = { skill: new Map(), agent: new Map() };
  function claim(kind, entry) {
    const owner = takenBy[kind].get(entry.dest);
    if (owner) throw new Error(`"${entry.dest}" is produced by both ${owner} and ${entry.source}`);
    takenBy[kind].set(entry.dest, entry.source);
    return entry;
  }

  for (const source of sources) {
    const base = (item, dest) => ({ source: source.id, prefix: source.prefix, originalName: item.name, dest });
    entries.push(
      ...select("skill", source, source.skills, source.include, (s, dest) => ({ ...base(s, dest), srcDir: s.dir })).map((e) => claim("skill", e)),
    );
    agentEntries.push(
      ...select("agent", source, source.agents ?? [], source.agentInclude, (a, dest) => ({ ...base(a, dest), srcFile: a.file })).map((e) => claim("agent", e)),
    );
    ignore.push(...(source.ignore ?? []));
  }
  return { entries, agentEntries, warnings, ignore };
}

export function rewriteSkillName(markdown, name) {
  if (NAME_LINE.test(markdown)) {
    return markdown.replace(NAME_LINE, (_, head, eol) => `${head}name: ${name}${eol}`);
  }
  return markdown.replace(/^---(\r?\n)/, (_, eol) => `---${eol}name: ${name}${eol}`);
}
