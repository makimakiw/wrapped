#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildConsolidatedCards } from "./lib/consolidate.mjs";
import { fetchAzure } from "./lib/azure.mjs";
import { fetchCursor } from "./lib/cursor.mjs";
import { fetchNewProjects } from "./lib/projects.mjs";
import { fetchGitHub } from "./lib/github.mjs";
import { createNameResolver, createTimeHelpers } from "./lib/names.mjs";
import { fetchTeams } from "./lib/teams.mjs";
import { computeTrakkaStats, fetchTrakka } from "./lib/trakka.mjs";
import { fetchSpotifyPlaylist } from "./lib/spotify.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadDotEnv() {
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

loadDotEnv();

const config = JSON.parse(readFileSync(join(__dirname, "config.json"), "utf8"));
const period = config.period;

mkdirSync(join(ROOT, "data"), { recursive: true });
mkdirSync(join(ROOT, "public/data"), { recursive: true });

const fmtName = createNameResolver(config);
const timeHelpers = createTimeHelpers(config);

console.log("=== Third Act Weekly Wrap — data build ===");
console.log(`Period: ${period.label}\n`);

const sources = {};

console.log("[1/6] GitHub…");
const gh = await fetchGitHub(config, period, fmtName, timeHelpers);
sources.github = { status: gh.status, real: true, ...gh.counts };

console.log("[2/6] Trakka…");
let trk = fetchTrakka(period);
trk = computeTrakkaStats(trk, period);
sources.trakka = {
  status: trk.status,
  real: true,
  entries: trk.entries.length,
};

console.log("[3/6] Azure DevOps…");
const az = await fetchAzure(config, period);
sources.azure = {
  status: az.status,
  real: az.real,
  authMethod: az.authMethod ?? null,
  mergedPrs: az.mergedPrs?.length ?? 0,
};

console.log("[4/6] Nya projekt…");
const projects = await fetchNewProjects(config, period, fmtName);
sources.projects = {
  status: projects.status,
  total: projects.total ?? 0,
  github: projects.githubCount ?? 0,
  azure: projects.azureCount ?? 0,
};

console.log("[5/6] Microsoft Teams…");
const teams = await fetchTeams(config, period);
sources.teams = {
  status: teams.status,
  real: teams.real,
  messages: teams.messages?.length ?? 0,
  channelMessages: teams.stats?.channelMessages ?? 0,
  chatMessages: teams.stats?.chatMessages ?? 0,
  groupChatsScanned: teams.stats?.groupChatsScanned ?? 0,
  hasQuote: Boolean(teams.quote),
  highlights: teams.highlights?.length ?? 0,
};

console.log("[6/7] Cursor…");
const cursor = await fetchCursor(config, period);
sources.cursor = {
  status: cursor.status,
  real: cursor.real,
  mode: cursor.mode,
  scope: cursor.mode === "team" ? "hela teamet" : "personlig nyckel",
  activeUsers: cursor.stats?.totals?.activeUsers ?? null,
  aiRequests: cursor.stats?.totals?.aiRequests ?? null,
  compare: cursor.compare ?? null,
  previousPeriod: cursor.previousPeriod ?? null,
  topModels: cursor.stats?.topModels?.slice(0, 3) ?? null,
  reason: cursor.reason ?? null,
  teamHint: cursor.stats?.teamHint ?? null,
};

console.log("[7/7] Spotify spellista…");
const playlistId = config.spotify?.playlistId ?? "1rBL2DEwVfa12UHVU1YvF4";
const music = await fetchSpotifyPlaylist(playlistId);
sources.spotify = {
  status: music.status,
  playlistId: music.playlistId,
  trackCount: music.trackCount ?? music.tracks.length,
  title: music.title ?? null,
};

const { cards, sections, poolSize } = buildConsolidatedCards({
  gh,
  az,
  trk,
  teams,
  cursor,
  projects,
  fmtName,
  org: config.org,
});

const wrapped = {
  generatedAt: new Date().toISOString(),
  period,
  org: config.org,
  sources,
  cards,
  sections,
  music: {
    playlistId: music.playlistId,
    playlistUrl: config.spotify?.playlistUrl ?? music.url,
    title: music.title,
    tracks: music.tracks,
  },
  meta: {
    githubCommits: gh.counts?.commits ?? 0,
    githubMergedPrs: gh.counts?.mergedPrs ?? 0,
    trakkaEntries: trk.entries.length,
    azureMergedPrs: az.mergedPrs?.length ?? 0,
    teamsMessages: teams.messages?.length ?? 0,
    cardCount: cards.length,
    sectionCount: sections.length,
  },
};

writeFileSync(
  join(ROOT, "public/data/wrapped.json"),
  JSON.stringify(wrapped, null, 2)
);

console.log("\n=== Build complete ===");
console.log(`Cards: ${cards.length} (pool: ${poolSize ?? "?"}, target ~12)`);
console.log(JSON.stringify(sources, null, 2));
