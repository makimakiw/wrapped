import { isDemofabrikkRepo } from "./projects.mjs";
import { fmtHours, makeCard, makeSection } from "./utils.mjs";

const TARGET_CARDS = 12;
const SECTION_ORDER = ["tid", "kod", "ai", "team"];
const SECTION_TARGET = { tid: 3, kod: 3, ai: 2, team: 4 };

function top(map) {
  if (!map?.size) return null;
  return [...map.entries()].sort((a, b) => b[1] - a[1])[0];
}

function topN(map, n = 2) {
  if (!map?.size) return [];
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function normName(name) {
  return String(name).toLowerCase().replace(/\s+/g, " ").trim();
}

function combinePeople(ghMerges, ghOpens, azurePrs, fmtName) {
  const byKey = new Map();

  function add(rawName, merges = 0, opens = 0) {
    if (!rawName) return;
    const display = rawName.includes("@") ? rawName.split("@")[0] : rawName;
    const key = normName(display);
    if (!byKey.has(key)) byKey.set(key, { name: display, merges: 0, opens: 0 });
    const e = byKey.get(key);
    e.merges += merges;
    e.opens += opens;
  }

  for (const [login, n] of ghMerges ?? []) add(fmtName(login), n, 0);
  for (const [login, n] of ghOpens ?? []) {
    const e = byKey.get(normName(fmtName(login)));
    if (e) e.opens += n;
    else add(fmtName(login), 0, n);
  }
  for (const pr of azurePrs ?? []) {
    const name =
      pr.createdBy?.displayName ??
      pr.createdBy?.uniqueName?.split("@")[0] ??
      null;
    add(name, 1, 0);
  }

  return byKey;
}

function shortModel(name) {
  return String(name ?? "")
    .replace(/^claude-/, "")
    .replace(/^gpt-/, "")
    .replace(/^composer-/, "composer ")
    .replace(/-/g, " ");
}

function statNum(stat) {
  const cleaned = String(stat ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s/g, "")
    .replace(",", ".");
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? null : n;
}

function isValidCard(card) {
  if (!card?.id || !card.title) return false;
  const stat = String(card.stat ?? "").trim();
  if (!stat || stat === "—") return false;

  const n = statNum(stat);
  if (n !== null && n <= 0) return false;

  if (card.variant === "quote") {
    const q = String(card.winner ?? "").replace(/^"|"$/g, "").trim();
    if (q.length < 8) return false;
    const rx = card.quotePanel?.reactionTotal ?? 0;
    if (rx <= 0) return false;
  }

  if (card.id === "team_rhythm") {
    const days = statNum(stat);
    if (days === null || days < 3) return false;
  }

  return true;
}

function azurePrsByCreator(az) {
  const map = new Map();
  for (const pr of az.mergedPrs ?? []) {
    const name =
      pr.createdBy?.displayName ??
      pr.createdBy?.uniqueName?.split("@")[0] ??
      null;
    if (!name) continue;
    map.set(name, (map.get(name) ?? 0) + 1);
  }
  return map;
}

function azurePipelineByProject(az) {
  const map = new Map();
  for (const run of az.pipelineRuns ?? []) {
    const p = run.projectName ?? "unknown";
    map.set(p, (map.get(p) ?? 0) + 1);
  }
  return map;
}

function azurePrsByProject(az) {
  const map = new Map();
  for (const pr of az.mergedPrs ?? []) {
    const p = pr.projectName ?? "unknown";
    map.set(p, (map.get(p) ?? 0) + 1);
  }
  return map;
}

function combinedActivityByPerson(gh, az, fmtName) {
  const byKey = new Map();
  for (const [login, commits] of gh.stats?.commitsByAuthor ?? []) {
    const name = fmtName(login);
    const key = normName(name);
    byKey.set(key, { name, commits, azurePrs: 0, total: commits });
  }
  for (const [name, azurePrs] of azurePrsByCreator(az)) {
    const key = normName(name);
    const e = byKey.get(key) ?? { name, commits: 0, azurePrs: 0, total: 0 };
    e.azurePrs = azurePrs;
    e.name = e.name || name;
    e.total = e.commits + e.azurePrs;
    byKey.set(key, e);
  }
  return byKey;
}

function commitsByRepoAuthor(gh) {
  const map = new Map();
  for (const item of gh.commits ?? []) {
    const repo = item.repository?.full_name ?? "unknown";
    const login = item.author?.login ?? item.commit?.author?.name ?? "unknown";
    if (!map.has(repo)) map.set(repo, new Map());
    const byAuthor = map.get(repo);
    byAuthor.set(login, (byAuthor.get(login) ?? 0) + 1);
  }
  return map;
}

function topPersonForRepo(gh, repoFullName, fmtName) {
  const byAuthor = commitsByRepoAuthor(gh).get(repoFullName);
  if (!byAuthor?.size) return null;
  const [login] = top(byAuthor);
  return fmtName(login);
}

function topPersonForAzureProject(az, projectName) {
  const map = new Map();
  for (const pr of az.mergedPrs ?? []) {
    if ((pr.projectName ?? "unknown") !== projectName) continue;
    const name =
      pr.createdBy?.displayName ??
      pr.createdBy?.uniqueName?.split("@")[0] ??
      null;
    if (!name) continue;
    map.set(name, (map.get(name) ?? 0) + 1);
  }
  return top(map)?.[0] ?? null;
}

function pickHotspot(gh, az, fmtName) {
  const s = gh.stats ?? {};
  let best = null;

  for (const [repo, commits] of s.commitsByRepo ?? []) {
    const short = repo.split("/").pop() ?? repo;
    if (isDemofabrikkRepo({ name: short, fullName: repo, description: "" })) continue;
    const ci = s.ciRunsByRepo?.get(repo) ?? 0;
    const score = commits + ci;
    if (!best || score > best.score) {
      best = {
        spot: short,
        winner: topPersonForRepo(gh, repo, fmtName),
        stat: commits,
        statLabel: "commits",
        detail: ci
          ? `${short} · ${ci} CI-körningar · GitHub Actions`
          : `${short} · ${commits} commits · GitHub`,
        score,
        id: "action_hub",
      };
    }
  }

  const pipelines = azurePipelineByProject(az);
  const azPrs = azurePrsByProject(az);
  for (const [project, runs] of pipelines) {
    const merges = azPrs.get(project) ?? 0;
    const score = runs + merges * 3;
    if (!best || score > best.score) {
      best = {
        spot: project,
        winner: topPersonForAzureProject(az, project),
        stat: runs,
        statLabel: "pipeline-körningar",
        detail: `${project} · ${merges} merges · ${runs} pipelines · Azure DevOps`,
        score,
        id: "action_hub",
      };
    }
  }

  for (const [project, merges] of azPrs) {
    if (pipelines.has(project)) continue;
    const score = merges * 3;
    if (!best || score > best.score) {
      best = {
        spot: project,
        winner: topPersonForAzureProject(az, project),
        stat: merges,
        statLabel: "merges",
        detail: `${project} · ${merges} merges · Azure DevOps`,
        score,
        id: "action_hub",
      };
    }
  }

  return best;
}

function kodTotals(gh, az) {
  const ghCommits = [...(gh.stats?.commitsByAuthor?.values() ?? [])].reduce(
    (s, n) => s + n,
    0
  );
  const ghPrs = gh.counts?.mergedPrs ?? 0;
  const azPrs = az.mergedPrs?.length ?? 0;
  return { ghCommits, ghPrs, azPrs };
}

function pickCards(candidates) {
  const pool = candidates.filter((c) => c?.card && isValidCard(c.card));

  const picked = [];
  const usedIds = new Set();
  const winnerHits = new Map();
  const usedKinds = new Set();

  const sectionCount = (section) => picked.filter((p) => p.section === section).length;

  const winnerKey = (c) => `${c.section}|${normName(c.card.winner)}`;

  const canPick = (c) => {
    if (usedIds.has(c.card.id)) return false;
    if (c.exclusive && usedKinds.has(c.exclusive)) return false;
    if (c.card.variant === "quote") return true;
    if ((winnerHits.get(winnerKey(c)) ?? 0) >= 2) return false;
    return true;
  };

  const add = (c) => {
    picked.push(c.card);
    usedIds.add(c.card.id);
    if (c.exclusive) usedKinds.add(c.exclusive);
    if (c.card.variant !== "quote") {
      winnerHits.set(winnerKey(c), (winnerHits.get(winnerKey(c)) ?? 0) + 1);
    }
  };

  for (const section of SECTION_ORDER) {
    const target = SECTION_TARGET[section];
    const sectionPool = pool
      .filter((c) => c.section === section)
      .sort((a, b) => b.score - a.score);

    for (const c of sectionPool.filter((x) => x.anchor)) {
      if (sectionCount(section) >= target) break;
      if (!canPick(c)) continue;
      add(c);
    }

    for (const c of sectionPool) {
      if (sectionCount(section) >= target) break;
      if (usedIds.has(c.card.id) || !canPick(c)) continue;
      add(c);
    }
  }

  return SECTION_ORDER.flatMap((section) => picked.filter((c) => c.section === section));
}

function buildPool({ gh, az, trk, teams, cursor, projects, fmtName, org }) {
  const pool = [];
  const push = (entry) => {
    if (entry?.card) pool.push(entry);
  };
  const ghSrc = "github+azure";
  const s = gh.stats ?? {};
  const trkStats = trk.stats;
  const totals = kodTotals(gh, az);

  if (trkStats?.workHoursByPerson?.size) {
    const [name, hours] = top(trkStats.workHoursByPerson);
    const projectTop = top(trkStats.hoursByProject);
    push({
      section: "tid",
      anchor: true,
      score: 95 + hours * 0.5,
      card: makeCard({
        id: "time_hero",
        emoji: "⏱️",
        title: "Timhjälten",
        subtitle: "Mest loggad tid",
        winner: name,
        stat: hours,
        statLabel: "timmar",
        detail: projectTop
          ? `Största projekt: ${projectTop[0]} (${projectTop[1]}h)`
          : "Trakka har koll",
        source: "trakka",
        section: "tid",
      }),
    });
  }

  if (trkStats?.customerHoursByPerson?.size) {
    const [custName, custH] = top(trkStats.customerHoursByPerson);
    const clientTop = top(trkStats.customerHoursByClient);
    const teamCustTotal = [...trkStats.customerHoursByPerson.values()].reduce(
      (sum, h) => sum + h,
      0
    );
    push({
      section: "tid",
      anchor: true,
      score: 88 + custH * 0.4,
      card: makeCard({
        id: "customer_champion",
        emoji: "💰",
        title: "Mest cash",
        subtitle: "Dragit in mest den veckan",
        winner: custName,
        stat: custH,
        statLabel: "kundtimmar",
        detail: clientTop
          ? `${clientTop[0]} (${clientTop[1]}h) · teamet totalt ${teamCustTotal} kundtimmar`
          : `Teamet loggade ${teamCustTotal} kundtimmar`,
        source: "trakka",
        section: "tid",
      }),
    });
  }

  if (trkStats?.daysByPerson?.size) {
    let consistency = null;
    for (const [n, days] of trkStats.daysByPerson) {
      const count = days.size;
      const total = trkStats.workDays?.length ?? 5;
      if (!consistency || count > consistency.days) {
        consistency = { name: n, days: count, total };
      }
    }
    if (consistency && consistency.days >= 3) {
      push({
        section: "tid",
        score: 70 + consistency.days * 8,
        card: makeCard({
          id: "team_rhythm",
          emoji: "🤝",
          title: "On a streak",
          subtitle: "Loggade varje vardag",
          winner: consistency.name,
          stat: consistency.days,
          statLabel: `av ${consistency.total} vardagar`,
          detail: `${consistency.name} · ${consistency.days}/${consistency.total} vardagar i rad`,
          source: "trakka",
          section: "tid",
        }),
      });
    }
  }

  if (trkStats?.projectsByPerson?.size) {
    const ranked = topN(
      new Map([...trkStats.projectsByPerson.entries()].map(([n, set]) => [n, set.size])),
      1
    );
    const [name, count] = ranked[0] ?? [];
    if (count >= 2) {
      push({
        section: "tid",
        score: 55 + count * 12,
        card: makeCard({
          id: "project_juggler",
          emoji: "🎪",
          title: "Projektjonglör",
          subtitle: "Flest projekt i Trakka",
          winner: name,
          stat: count,
          statLabel: "projekt",
          detail: `${count} projekt den veckan — multitasking level unlocked`,
          source: "trakka",
          section: "tid",
        }),
      });
    }
  }

  if (trkStats?.customerHoursByClient?.size) {
    const [client, hours] = top(trkStats.customerHoursByClient);
    const runner = topN(trkStats.customerHoursByClient, 2)[1];
    if (hours >= 8 && (!runner || hours >= runner[1] * 1.2)) {
      push({
        section: "tid",
        score: 50 + hours * 0.3,
        card: makeCard({
          id: "top_client",
          emoji: "🏢",
          title: "Veckans kund",
          subtitle: "Mest timmar den veckan",
          winner: client,
          stat: hours,
          statLabel: "kundtimmar",
          detail: `Teamet la ${hours}h på ${client}`,
          source: "trakka",
          section: "tid",
        }),
      });
    }
  }

  const repos = projects?.repos ?? [];
  const projectTotal = projects?.total ?? repos.length;
  if (projectTotal >= 1) {
    const topCreator = top(projects.byAuthor);
    const named = repos.filter((r) => r.author).slice(0, 2).map((r) => r.name);
    push({
      section: "kod",
      score: 84 + projectTotal * 10,
      card: makeCard({
        id: "new_projects",
        emoji: "🌱",
        title: "Nya projekt",
        subtitle: "Repos som föddes den veckan",
        winner: topCreator ? topCreator[0] : named.join(", ") || "Teamet",
        stat: projectTotal,
        statLabel: "repos",
        detail: topCreator
          ? `${topCreator[0]} startade ${topCreator[1]} · GitHub & Azure`
          : `${projectTotal} nya repos · GitHub & Azure`,
        source: ghSrc,
        section: "kod",
      }),
    });
  }

  const activityMap = combinedActivityByPerson(gh, az, fmtName);
  const activityTop = top(
    new Map([...activityMap.entries()].map(([k, v]) => [k, v.total]))
  );
  if (activityTop && activityTop[1] > 0) {
    const act = activityMap.get(activityTop[0]);
    push({
      section: "kod",
      anchor: true,
      score: 92 + activityTop[1] * 0.15,
      card: makeCard({
        id: "code_flow",
        emoji: "🔥",
        title: "Kodflödet",
        subtitle: "Mest aktiv · GitHub & Azure",
        winner: act.name,
        stat: act.total,
        statLabel: "commits + merges",
        detail: `${act.commits} commits · ${act.azurePrs} Azure-merges · ${org}`,
        source: ghSrc,
        section: "kod",
      }),
    });
  }

  if (s.linesByAuthor?.size) {
    const [login, lines] = top(s.linesByAuthor);
    const commitWinner = activityTop ? activityMap.get(activityTop[0])?.name : null;
    const linesWinner = fmtName(login);
    if (lines >= 500 && normName(linesWinner) !== normName(commitWinner ?? "")) {
      push({
        section: "kod",
        score: 78 + Math.min(lines / 500, 40),
        card: makeCard({
          id: "code_machine",
          emoji: "⌨️",
          title: "Kodmaskinen",
          subtitle: "Flest rader i mergade PR:ar",
          winner: linesWinner,
          stat: lines.toLocaleString("sv-SE"),
          statLabel: "rader",
          detail: `+/- i mergade PR:ar · ${org}`,
          source: ghSrc,
          section: "kod",
        }),
      });
    }
  }

  const people = combinePeople(s.mergesByUser, s.prsOpenedByUser, az.mergedPrs, fmtName);
  const shipTop = top(new Map([...people.values()].map((p) => [p.name, p.merges + p.opens])));
  if (shipTop && shipTop[1] > 0) {
    const [name, total] = shipTop;
    const p = [...people.values()].find((x) => x.name === name);
    push({
      section: "kod",
      anchor: true,
      score: 90 + total * 0.8,
      card: makeCard({
        id: "ship_master",
        emoji: "🚀",
        title: "Ship Master",
        subtitle: "Mest shipping · GitHub & Azure",
        winner: name,
        stat: total,
        statLabel: "PR:ar",
        detail: `${p?.merges ?? 0} merges · ${p?.opens ?? 0} öppnade · ${totals.ghPrs + totals.azPrs} totalt`,
        source: ghSrc,
        section: "kod",
      }),
    });
  }

  const hotspot = pickHotspot(gh, az, fmtName);
  if (hotspot && hotspot.stat > 0 && hotspot.winner) {
    push({
      section: "kod",
      exclusive: "hotspot",
      score: 72 + hotspot.score * 0.2,
      card: makeCard({
        id: "action_hub",
        emoji: "📦",
        title: "Action Hub",
        subtitle: "Hetast repo · GitHub & Azure",
        winner: hotspot.winner,
        stat: hotspot.stat,
        statLabel: hotspot.statLabel,
        detail: hotspot.detail,
        source: ghSrc,
        section: "kod",
      }),
    });
  }

  if (s.ciRunsByRepo?.size) {
    const ciRanked = [...s.ciRunsByRepo.entries()]
      .filter(([repo]) => {
        const short = repo.split("/").pop() ?? repo;
        return !isDemofabrikkRepo({ name: short, fullName: repo, description: "" });
      })
      .sort((a, b) => b[1] - a[1]);
    const [repo, count] = ciRanked[0] ?? [];
    const ciWinner = repo ? topPersonForRepo(gh, repo, fmtName) : null;
    if (repo && count >= 10 && ciWinner) {
      const short = repo.split("/").pop();
      push({
        section: "kod",
        exclusive: "hotspot",
        score: 68 + count * 0.25,
        card: makeCard({
          id: "ci_champion",
          emoji: "🏗️",
          title: "CI-maratonet",
          subtitle: "Flest pipeline-körningar",
          winner: ciWinner,
          stat: count,
          statLabel: "körningar",
          detail: `${short} — pipelinen fick träna`,
          source: ghSrc,
          section: "kod",
        }),
      });
    }
  }

  if (s.nightOwl && s.earlyBird) {
    const samePerson = s.nightOwl.login === s.earlyBird.login;
    if (samePerson) {
      push({
        section: "kod",
        exclusive: "time_of_day",
        score: 88,
        card: makeCard({
          id: "day_night",
          emoji: "🦉",
          title: "Dygnet runt",
          subtitle: "Först upp och sist i säng",
          winner: fmtName(s.nightOwl.login),
          stat: `${s.earlyBird.hour}–${s.nightOwl.hour}`,
          statLabel: "Stockholm",
          detail: `${s.earlyBird.repo.split("/").pop()} → ${s.nightOwl.repo.split("/").pop()} — sömn är överskattat`,
          source: ghSrc,
          section: "kod",
        }),
      });
    } else {
      push({
        section: "kod",
        exclusive: "time_of_day",
        score: 62,
        card: makeCard({
          id: "night_owl",
          emoji: "🦉",
          title: "Nattugglan",
          subtitle: "Senaste kvällscommiten",
          winner: fmtName(s.nightOwl.login),
          stat: s.nightOwl.hour,
          statLabel: "Stockholm",
          detail: `${s.nightOwl.repo.split("/").pop()} — vi säger inget om sömnen`,
          source: ghSrc,
          section: "kod",
        }),
      });
      push({
        section: "kod",
        exclusive: "time_of_day",
        score: 58,
        card: makeCard({
          id: "early_bird",
          emoji: "🐦",
          title: "Morgonfågeln",
          subtitle: "Tidigaste commit före 07:00",
          winner: fmtName(s.earlyBird.login),
          stat: s.earlyBird.hour,
          statLabel: "Stockholm",
          detail: `${s.earlyBird.repo.split("/").pop()} — kaffet hade inte ens hunnit kallna`,
          source: ghSrc,
          section: "kod",
        }),
      });
    }
  }

  if (s.fastestReviewer && s.fastestReviewer.reviewCount >= 2) {
    push({
      section: "kod",
      exclusive: "reviewer",
      score: 70 + (24 - Math.min(s.fastestReviewer.hours, 24)) * 2,
      card: makeCard({
        id: "fast_reviewer",
        emoji: "⚡",
        title: "Snabbaste granskaren",
        subtitle: "Review before coffee gets cold",
        winner: fmtName(s.fastestReviewer.login),
        stat: fmtHours(s.fastestReviewer.hours),
        statLabel: "median review",
        detail: `${s.fastestReviewer.reviewCount} reviews · GitHub & Azure`,
        source: ghSrc,
        section: "kod",
      }),
    });
  }

  if (
    s.thoughtfulReviewer &&
    s.thoughtfulReviewer.reviewCount >= 2 &&
    s.thoughtfulReviewer.login !== s.fastestReviewer?.login &&
    s.thoughtfulReviewer.hours >= 4
  ) {
    push({
      section: "kod",
      exclusive: "reviewer",
      score: 64 + Math.min(s.thoughtfulReviewer.hours, 48),
      card: makeCard({
        id: "thoughtful_reviewer",
        emoji: "🧠",
        title: "Den fundersamma",
        subtitle: "Längsta median-tid till review",
        winner: fmtName(s.thoughtfulReviewer.login),
        stat: fmtHours(s.thoughtfulReviewer.hours),
        statLabel: "median review",
        detail: "Kvalitet tar tid — och det är helt okej",
        source: ghSrc,
        section: "kod",
      }),
    });
  }

  if (s.prsOpenedByUser?.size) {
    const [login, count] = top(s.prsOpenedByUser);
    if (count >= 3) {
      push({
        section: "kod",
        score: 52 + count * 2,
        card: makeCard({
          id: "pr_opener",
          emoji: "📝",
          title: "PR-fabriken",
          subtitle: "Flest öppnade PR:ar",
          winner: fmtName(login),
          stat: count,
          statLabel: "PR:ar",
          detail: "Shipping mindset · GitHub & Azure",
          source: ghSrc,
          section: "kod",
        }),
      });
    }
  }

  if (s.issuesClosedByUser?.size) {
    const [login, count] = top(s.issuesClosedByUser);
    if (count >= 1) {
      push({
        section: "kod",
        score: 48 + count * 8,
        card: makeCard({
          id: "bug_hunter",
          emoji: "🐛",
          title: "Bug-jägaren",
          subtitle: "Flest stängda issues",
          winner: fmtName(login),
          stat: count,
          statLabel: "issues",
          detail: "Städade bordet i backlogen",
          source: ghSrc,
          section: "kod",
        }),
      });
    }
  }

  const cStats = cursor?.stats;
  if (cursor?.mode === "team" && cStats?.totals?.aiRequests > 0) {
    const u = cStats.topUser;
    const totalsC = cStats.totals;
    const topModel = cStats.topModels?.[0];
    push({
      section: "ai",
      anchor: true,
      score: 96 + totalsC.aiRequests * 0.05,
      card: makeCard({
        id: "cursor_pulse",
        emoji: "✨",
        title: "Cursor-veckan",
        subtitle: `${totalsC.activeUsers} personer · hela teamet`,
        winner: u?.name ?? "Teamet",
        stat: totalsC.aiRequests.toLocaleString("sv-SE"),
        statLabel: "AI-requests",
        detail: "",
        source: "cursor",
        variant: "cursor",
        section: "ai",
        cursorPanel: {
          champion: u ? { name: u.name } : null,
          topModel: topModel ? { name: shortModel(topModel.name) } : null,
        },
      }),
    });

    const linesLeader = [...(cStats.users?.values() ?? [])]
      .filter((u) => u.acceptedLinesAdded > 0)
      .sort((a, b) => b.acceptedLinesAdded - a.acceptedLinesAdded)[0];
    if (linesLeader && linesLeader.acceptedLinesAdded >= 200) {
      push({
        section: "ai",
        score: 78 + linesLeader.acceptedLinesAdded * 0.003,
        card: makeCard({
          id: "cursor_lines",
          emoji: "✍️",
          title: "AI-raderna",
          subtitle: "Mest accepterad AI-kod",
          winner: linesLeader.name,
          stat: linesLeader.acceptedLinesAdded.toLocaleString("sv-SE"),
          statLabel: "rader",
          detail: "Rader teamet accepterat från Cursor",
          source: "cursor",
          section: "ai",
        }),
      });
    }

    const tabLeader = [...(cStats.users?.values() ?? [])]
      .filter((u) => u.totalTabsAccepted > 0)
      .sort((a, b) => b.totalTabsAccepted - a.totalTabsAccepted)[0];
    if (tabLeader && tabLeader.totalTabsAccepted >= 20) {
      push({
        section: "ai",
        score: 68 + tabLeader.totalTabsAccepted * 0.1,
        card: makeCard({
          id: "cursor_tabs",
          emoji: "⇥",
          title: "Tab-kungen",
          subtitle: "Mest accepterade autocomplete",
          winner: tabLeader.name,
          stat: tabLeader.totalTabsAccepted,
          statLabel: "tabs",
          detail: "Tab tab tab · Cursor",
          source: "cursor",
          section: "ai",
        }),
      });
    }

    if (topModel && cStats.topModels?.[0]?.requests > 0) {
      const model = cStats.topModels[0];
      push({
        section: "ai",
        score: 72 + model.requests * 0.04,
        card: makeCard({
          id: "cursor_model",
          emoji: "🧠",
          title: "Favoritmodellen",
          subtitle: "Teamets mest valda AI",
          winner: shortModel(model.name),
          stat: model.share,
          statLabel: "% av requests",
          detail: `${model.requests.toLocaleString("sv-SE")} requests · hela teamet`,
          source: "cursor",
          section: "ai",
        }),
      });
    }

    if (totalsC.bugbotUsages > 0) {
      const bugLeader = [...(cStats.users?.values() ?? [])]
        .filter((u) => u.bugbotUsages > 0)
        .sort((a, b) => b.bugbotUsages - a.bugbotUsages)[0];
      if (bugLeader) {
        push({
          section: "ai",
          score: 60 + bugLeader.bugbotUsages * 5,
          card: makeCard({
            id: "cursor_bugbot",
            emoji: "🤖",
            title: "Bugbot-veteranen",
            subtitle: "Mest Bugbot den veckan",
            winner: bugLeader.name,
            stat: bugLeader.bugbotUsages,
            statLabel: "körningar",
            detail: "Lät roboten granska",
            source: "cursor",
            section: "ai",
          }),
        });
      }
    }
  } else if (cursor?.mode === "cloud" && cStats?.agentCount > 0 && cStats.topAgent) {
    push({
      section: "ai",
      anchor: true,
      score: 85 + cStats.agentCount * 3,
      card: makeCard({
        id: "cursor_agents",
        emoji: "☁️",
        title: "Cloud Agents",
        subtitle: "Cursor körde i bakgrunden",
        winner: cStats.topAgent.name || "Agent",
        stat: cStats.agentCount,
        statLabel: "agenter",
        detail: cStats.totalTokens
          ? `${(cStats.totalTokens / 1000).toFixed(0)}k tokens`
          : cStats.ownerName ?? "Cursor",
        source: "cursor",
        section: "ai",
      }),
    });
  }

  const teamCards =
    teams.teamCards ?? teams.teamQuotes ?? (teams.quote ? [teams.quote] : []);
  const cardIds = {
    reactions: "teams_reactions",
    victory: "teams_victory",
    chat_star: "teams_chat_star",
  };

  for (const item of teamCards) {
    if (item.kind === "chat_star" && item.stat > 0) {
      push({
        section: "team",
        anchor: true,
        score: 94 + item.stat * 0.3,
        card: makeCard({
          id: cardIds.chat_star,
          emoji: item.cardEmoji ?? "🗣️",
          title: item.cardTitle ?? "Mest aktiv i chattarna",
          subtitle: item.subtitle ?? "Gruppchattar",
          winner: item.author,
          stat: item.stat,
          statLabel: item.statLabel ?? "meddelanden",
          detail: item.detail,
          source: "teams",
          section: "team",
        }),
      });
      continue;
    }

    if (item.kind === "victory") {
      const rx = item.reactionDisplay ?? { total: 0, emojis: [] };
      push({
        section: "team",
        anchor: true,
        score: 97,
        card: makeCard({
          id: cardIds.victory,
          emoji: item.cardEmoji ?? "🏆",
          title: item.cardTitle ?? "Victory moment",
          subtitle: item.channel,
          winner: item.text,
          stat: item.author,
          statLabel: "sa det",
          detail: item.context ?? item.channel,
          source: "teams",
          variant: "quote",
          section: "team",
          quotePanel: { reactions: rx.emojis, reactionTotal: rx.total },
        }),
      });
      continue;
    }

    if (item.kind === "reactions") {
      const rx = item.reactionDisplay ?? { total: 0, emojis: [] };
      if (rx.total > 0) {
        push({
          section: "team",
          anchor: true,
          score: 96 + rx.total * 2,
          card: makeCard({
            id: cardIds.reactions,
            emoji: item.cardEmoji ?? "🔥",
            title: item.cardTitle ?? "Flest reaktioner",
            subtitle: item.channel,
            winner: item.text,
            stat: item.author,
            statLabel: "sa det",
            detail: item.context ?? item.channel,
            source: "teams",
            variant: "quote",
            section: "team",
            quotePanel: { reactions: rx.emojis, reactionTotal: rx.total },
          }),
        });
      }
    }
  }

  if (teams.stats?.messagesByChannel?.size) {
    const [channel, count] = top(teams.stats.messagesByChannel);
    const channelLabel = channel.split("/").pop()?.trim() || channel;
    const topInChannel = top(teams.stats.messagesByChannelAuthor?.get(channel));
    const channelWinner = topInChannel?.[0] ?? top(teams.stats.messagesByAuthor)?.[0];
    if (count >= 10 && channelWinner) {
      push({
        section: "team",
        score: 55 + count * 0.3,
        card: makeCard({
          id: "teams_hot_channel",
          emoji: "📢",
          title: "Hetaste kanalen",
          subtitle: "Mest aktiv i Teams",
          winner: channelWinner,
          stat: count,
          statLabel: "meddelanden",
          detail: `${channelLabel} · ${count} meddelanden`,
          source: "teams",
          section: "team",
        }),
      });
    }
  }

  if (!teamCards.length && teams.real && teams.stats?.totalMessages > 0) {
    const voice = top(teams.stats.messagesByAuthor);
    push({
      section: "team",
      score: 50 + teams.stats.totalMessages * 0.2,
      card: makeCard({
        id: "teams_pulse",
        emoji: "📣",
        title: "Teams-pulsen",
        subtitle: top(teams.stats.messagesByChannel)?.[0] ?? "Teamkanaler",
        winner: voice?.[0] ?? "Teamet",
        stat: teams.stats.totalMessages,
        statLabel: "meddelanden",
        detail: "Lugn vecka i chatten",
        source: "teams",
        section: "team",
      }),
    });
  }

  return pool;
}

export function buildConsolidatedCards(ctx) {
  const sectionDefs = [
    makeSection({
      id: "tid",
      title: "Tid & kund",
      subtitle: "Trakka · tider & loggar",
      emoji: "⏱️",
    }),
    makeSection({
      id: "kod",
      title: "Kod & shipping",
      subtitle: "GitHub & Azure · sammanslaget",
      emoji: "💻",
    }),
    makeSection({
      id: "ai",
      title: "AI & Cursor",
      subtitle: "Teamets Cursor-vecka",
      emoji: "✨",
    }),
    makeSection({
      id: "team",
      title: "Teams & kultur",
      subtitle: "Citat och skitsnack",
      emoji: "💬",
    }),
  ];

  const pool = buildPool(ctx);
  const cards = pickCards(pool);

  const sections = sectionDefs
    .map((def) => ({
      ...def,
      cardCount: cards.filter((c) => c.section === def.id).length,
    }))
    .filter((s) => s.cardCount > 0);

  return { cards, sections, poolSize: pool.length };
}
