const STABLE = /^v?(\d+)\.(\d+)\.(\d+)$/;

export const isReleaseTag = (tag) => STABLE.test(tag);

export function parseLsRemoteTags(output) {
  const tags = [];
  for (const line of output.split(/\r?\n/)) {
    const m = /\trefs\/tags\/(.+)$/.exec(line);
    if (m && !m[1].endsWith("^{}")) tags.push(m[1]);
  }
  return tags;
}

export function pickLatestRelease(tags) {
  let best = null;
  let bestKey = null;
  for (const tag of tags) {
    const m = STABLE.exec(tag);
    if (!m) continue;
    const key = m.slice(1).map(Number);
    if (!bestKey || compare(key, bestKey) > 0) {
      best = tag;
      bestKey = key;
    }
  }
  return best;
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
