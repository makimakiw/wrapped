import { execSync } from "node:child_process";

export function run(cmd) {
  return execSync(cmd, { encoding: "utf8", maxBuffer: 80 * 1024 * 1024 });
}

export function ghApi(path) {
  return JSON.parse(run(`gh api '${path}'`));
}

export function ghSearch(endpoint, query, maxPages = 10) {
  const items = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = ghApi(`${endpoint}?q=${query}&per_page=100&page=${page}`);
    items.push(...(res.items ?? []));
    if (!res.items?.length || items.length >= res.total_count) break;
  }
  return items;
}

export function trakka(cmd) {
  return JSON.parse(run(`trakka ${cmd}`));
}

export function topEntry(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1])[0];
}

export function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function fmtHours(h) {
  if (h == null || !Number.isFinite(h)) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${h.toFixed(1)} h`;
}

export function excludeLeave(entry) {
  const name = entry.item?.name?.toLowerCase() ?? "";
  return !["ledig", "semester", "sjuk", "vab"].some((k) => name.includes(k));
}

export function weekdayDates(from, to) {
  const days = [];
  for (let d = new Date(from); d <= new Date(to); d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow >= 1 && dow <= 5) days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

export function inPeriod(iso, from, to) {
  const d = iso?.slice(0, 10);
  return d && d >= from && d <= to;
}

export function makeCard({
  id,
  emoji,
  title,
  subtitle,
  winner,
  stat,
  statLabel,
  detail,
  source,
  real = true,
  variant,
  highlights,
  cursorPanel,
  projectsPanel,
  quotePanel,
  section,
}) {
  const card = {
    id,
    emoji,
    title,
    subtitle,
    winner: String(winner),
    stat: String(stat),
    statLabel,
    detail,
    source,
    real,
  };
  if (variant) card.variant = variant;
  if (highlights?.length) card.highlights = highlights;
  if (cursorPanel) card.cursorPanel = cursorPanel;
  if (projectsPanel) card.projectsPanel = projectsPanel;
  if (quotePanel) card.quotePanel = quotePanel;
  if (section) card.section = section;
  return card;
}

export function makeSection({ id, title, subtitle, emoji }) {
  return { id, title, subtitle, emoji };
}
