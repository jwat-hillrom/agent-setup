import { posix, relative, sep } from "node:path";

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const toPosix = (p) => p.split(sep).join("/");

// Per source: bare skill/agent name -> installed name, source-relative skill folder -> installed name,
// and a GitHub URL for links that point at upstream files that are not installed.
export function buildRewrites({ entries, agentEntries }, sources) {
  const out = {};
  for (const { id, root, repo, tag } of sources) {
    const names = new Map();
    const skillDirs = new Map();
    for (const e of entries.filter((x) => x.source === id)) {
      names.set(e.originalName, e.dest);
      skillDirs.set(toPosix(relative(root, e.srcDir)), e.dest);
    }
    for (const e of agentEntries.filter((x) => x.source === id)) {
      if (!names.has(e.originalName)) names.set(e.originalName, e.dest);
    }
    out[id] = { root, names, skillDirs, webBase: githubBlobBase(repo, tag) };
  }
  return out;
}

export function githubBlobBase(repo, tag) {
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(repo ?? "");
  return m && tag ? `https://github.com/${m[1]}/blob/${tag}` : null;
}

// Rewrites only unambiguous references to sibling skills/agents: `/name` commands, `name` followed by
// "skill"/"agent", "skill: `name`", and quoted names after "Skill tool" on a line. Bare backticked
// words are left alone because sources also use them for labels (e.g. wayfinder's `research` tickets).
export function rewriteReferences(text, names) {
  if (!names.size) return text;
  const alt = [...names.keys()].sort((a, b) => b.length - a.length).map(escape).join("|");
  const to = (n) => names.get(n);
  return text
    .replace(new RegExp(`(?<![\\w/.\\-~])/(${alt})(?![\\w/\\-])`, "g"), (_, n) => `/${to(n)}`)
    .replace(new RegExp("`(" + alt + ")`(?=\\s+(?:skill|agent|sub-?agent)s?\\b)", "gi"), (_, n) => "`" + to(n) + "`")
    .replace(new RegExp("(\\b(?:skill|agent):?\\s+)`(" + alt + ")`", "gi"), (_, pre, n) => pre + "`" + to(n) + "`")
    .replace(/\bSkill tool\b.*$/gm, (tail) =>
      tail.replace(new RegExp("([\"'`])(" + alt + ")\\1", "g"), (_, q, n) => q + to(n) + q),
    );
}

// Fixes relative Markdown links after a skill is copied out of its source tree:
// links into another installed skill point at its installed folder, links to other upstream
// files point at GitHub at the pinned tag, and links inside the same skill are left alone.
//   fileDir      source-root-relative folder of the file being rewritten
//   ownDir       source-root-relative path of the unit being installed (skill folder or agent file)
//   installedDir repo-relative folder the file is installed into
export function rewriteLinks(text, { fileDir, ownDir, installedDir, skillDirs, webBase }) {
  const fix = (target) => {
    const angle = /^<(.*)>$/.exec(target);
    const raw = angle ? angle[1] : target;
    if (!raw || /^([a-z][a-z0-9+.-]*:|#|\/)/i.test(raw)) return target;
    const cut = raw.search(/[#?]/);
    const pathPart = cut === -1 ? raw : raw.slice(0, cut);
    const suffix = cut === -1 ? "" : raw.slice(cut);
    if (!pathPart) return target;
    const resolved = posix.normalize(posix.join(fileDir, decodeURI(pathPart)));
    if (resolved === ".." || resolved.startsWith("../")) return target;
    const within = (dir) => resolved === dir || resolved.startsWith(`${dir}/`);
    if (within(ownDir)) return target;
    let next = null;
    for (const [dir, dest] of skillDirs) {
      if (within(dir)) {
        next = posix.relative(installedDir, posix.join(".github/skills", dest, resolved.slice(dir.length))) + suffix;
        break;
      }
    }
    if (!next && webBase) next = `${webBase}/${encodeURI(resolved)}${suffix}`;
    if (!next) return target;
    return angle || /\s/.test(next) ? `<${next}>` : next;
  };
  return text
    .replace(/(\]\()(<[^>\n]*>|[^)\s]+)/g, (_, open, target) => open + fix(target))
    .replace(/^( {0,3}\[[^\]\n]+\]:[ \t]*)(\S+)/gm, (_, head, target) => head + fix(target));
}
