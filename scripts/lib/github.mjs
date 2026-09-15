import { ghApi, ghSearch, median, run } from "./utils.mjs";

function parseRepoFromIssue(issue) {
  const m = issue.repository_url?.match(/repos\/(.+\/.+)$/);
  return m?.[1] ?? null;
}

export async function fetchGitHub(config, { from, to }, fmtName, { toStockholmHour, toStockholmTime }) {
  const org = config.org;
  const result = {
    status: "pending",
    commits: [],
    mergedPrs: [],
    closedIssues: [],
    mergeDetails: [],
    stats: {},
  };

  try {
    result.commits = ghSearch(
      "search/commits",
      `org:${org}+committer-date:>=${from}`
    ).filter((c) => {
      const d = c.commit?.author?.date?.slice(0, 10);
      return d && d >= from && d <= to;
    });
  } catch (e) {
    result.status = "error";
    result.error = String(e.message ?? e);
    return result;
  }

  result.mergedPrs = ghSearch(
    "search/issues",
    `org:${org}+is:pr+is:merged+merged:>=${from}`
  ).filter((pr) => {
    const d = pr.closed_at?.slice(0, 10);
    return d && d >= from && d <= to;
  });

  result.closedIssues = ghSearch(
    "search/issues",
    `org:${org}+is:issue+is:closed+closed:>=${from}`
  ).filter((i) => {
    const d = i.closed_at?.slice(0, 10);
    return d && d >= from && d <= to;
  });

  const commitsByAuthor = new Map();
  const commitsByRepo = new Map();
  let nightOwl = null;
  let earlyBird = null;

  for (const item of result.commits) {
    const login = item.author?.login ?? item.commit?.author?.name ?? "unknown";
    commitsByAuthor.set(login, (commitsByAuthor.get(login) ?? 0) + 1);
    const repo = item.repository?.full_name ?? "unknown";
    commitsByRepo.set(repo, (commitsByRepo.get(repo) ?? 0) + 1);

    const date = item.commit?.author?.date;
    if (!date) continue;
    const hour = toStockholmHour(date);
    if (hour >= 22 || hour < 5) {
      if (!nightOwl || date > nightOwl.date) {
        nightOwl = { login, date, repo, hour: toStockholmTime(date) };
      }
    }
    if (hour >= 5 && hour < 7) {
      if (!earlyBird || date < earlyBird.date) {
        earlyBird = { login, date, repo, hour: toStockholmTime(date) };
      }
    }
  }

  const mergesByUser = new Map();
  const prsOpenedByUser = new Map();
  const linesByAuthor = new Map();
  const reviewHoursByUser = new Map();
  let longestFirstReview = null;

  console.log(`  Processing ${result.mergedPrs.length} merged PRs…`);
  for (const pr of result.mergedPrs) {
    const opener = pr.user?.login;
    if (opener) prsOpenedByUser.set(opener, (prsOpenedByUser.get(opener) ?? 0) + 1);

    const fullRepo = parseRepoFromIssue(pr);
    if (!fullRepo) continue;
    const [owner, repo] = fullRepo.split("/");

    try {
      const detail = ghApi(`repos/${owner}/${repo}/pulls/${pr.number}`);
      result.mergeDetails.push(detail);

      const merger = detail.merged_by?.login;
      if (merger) mergesByUser.set(merger, (mergesByUser.get(merger) ?? 0) + 1);

      const files = run(`gh api 'repos/${owner}/${repo}/pulls/${pr.number}/files' --paginate`)
        .trim()
        .split("\n")
        .flatMap((line) => JSON.parse(line));
      let adds = 0;
      let dels = 0;
      for (const f of files) {
        adds += f.additions ?? 0;
        dels += f.deletions ?? 0;
      }
      const author = detail.user?.login ?? opener;
      if (author) {
        linesByAuthor.set(author, (linesByAuthor.get(author) ?? 0) + adds + dels);
      }

      const reviews = ghApi(`repos/${owner}/${repo}/pulls/${pr.number}/reviews`);
      const created = new Date(detail.created_at).getTime();
      const meaningful = reviews.filter(
        (r) => r.user?.login && r.user.login !== detail.user?.login && r.submitted_at
      );
      if (meaningful.length) {
        const first = meaningful.sort(
          (a, b) => new Date(a.submitted_at) - new Date(b.submitted_at)
        )[0];
        const hours = (new Date(first.submitted_at) - created) / 3_600_000;
        if (hours >= 0) {
          if (!longestFirstReview || hours > longestFirstReview.hours) {
            longestFirstReview = {
              hours,
              pr: detail.title,
              repo: fullRepo,
              reviewer: first.user.login,
            };
          }
          for (const r of meaningful) {
            const reviewer = r.user.login;
            const h = (new Date(r.submitted_at) - created) / 3_600_000;
            if (h < 0) continue;
            if (!reviewHoursByUser.has(reviewer)) reviewHoursByUser.set(reviewer, []);
            reviewHoursByUser.get(reviewer).push(h);
          }
        }
      }
    } catch {
      /* skip single PR */
    }
  }

  let fastestReviewer = null;
  let thoughtfulReviewer = null;
  for (const [login, hours] of reviewHoursByUser) {
    if (hours.length < 2) continue;
    const med = median(hours);
    if (!fastestReviewer || med < fastestReviewer.hours) {
      fastestReviewer = { login, hours: med, reviewCount: hours.length };
    }
    if (!thoughtfulReviewer || med > thoughtfulReviewer.hours) {
      thoughtfulReviewer = { login, hours: med, reviewCount: hours.length };
    }
  }

  const issuesClosedByUser = new Map();
  for (const issue of result.closedIssues) {
    const fullRepo = parseRepoFromIssue(issue);
    if (!fullRepo) continue;
    try {
      const events = ghApi(`repos/${fullRepo}/issues/${issue.number}/events`);
      const closed = events.find((e) => e.event === "closed");
      const login = closed?.actor?.login ?? issue.user?.login;
      if (login) issuesClosedByUser.set(login, (issuesClosedByUser.get(login) ?? 0) + 1);
    } catch {
      const login = issue.user?.login;
      if (login) issuesClosedByUser.set(login, (issuesClosedByUser.get(login) ?? 0) + 1);
    }
  }

  const topRepos = [...commitsByRepo.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([repo]) => repo);

  const ciRunsByRepo = new Map();
  console.log(`  Checking CI on top ${topRepos.length} repos…`);
  for (const fullRepo of topRepos) {
    try {
      const runs = ghApi(
        `repos/${fullRepo}/actions/runs?created=${from}..${to}&per_page=100`
      );
      if (runs.total_count > 0) ciRunsByRepo.set(fullRepo, runs.total_count);
    } catch {
      /* skip */
    }
  }

  result.status = "ok";
  result.stats = {
    commitsByAuthor,
    commitsByRepo,
    nightOwl,
    earlyBird,
    mergesByUser,
    prsOpenedByUser,
    linesByAuthor,
    fastestReviewer,
    thoughtfulReviewer,
    longestFirstReview,
    issuesClosedByUser,
    ciRunsByRepo,
  };
  result.counts = {
    commits: result.commits.length,
    mergedPrs: result.mergedPrs.length,
    closedIssues: result.closedIssues.length,
  };

  return result;
}

export function githubCards(gh, fmtName, fmtHours, org) {
  const cards = [];
  const s = gh.stats;

  if (s.commitsByAuthor?.size) {
    const [login, count] = [...s.commitsByAuthor.entries()].sort((a, b) => b[1] - a[1])[0];
    cards.push({
      id: "commit_champion",
      emoji: "🔥",
      title: "Commit Champion",
      subtitle: "Flest commits den här veckan",
      winner: fmtName(login),
      stat: count,
      statLabel: "commits",
      detail: `${count} commits i ${org}`,
      source: "github",
    });
  }

  if (s.linesByAuthor?.size) {
    const [login, lines] = [...s.linesByAuthor.entries()].sort((a, b) => b[1] - a[1])[0];
    cards.push({
      id: "code_machine",
      emoji: "⌨️",
      title: "Kodmaskinen",
      subtitle: "Flest rader i mergade PR:ar (+/−)",
      winner: fmtName(login),
      stat: lines.toLocaleString("sv-SE"),
      statLabel: "rader",
      detail: "Räknar additions + deletions i mergade PR:ar",
      source: "github",
    });
  }

  if (s.nightOwl) {
    cards.push({
      id: "night_owl",
      emoji: "🦉",
      title: "Nattugglan",
      subtitle: "Senaste kvällscommiten",
      winner: fmtName(s.nightOwl.login),
      stat: s.nightOwl.hour,
      statLabel: "Stockholm",
      detail: `${s.nightOwl.repo.split("/").pop()} — vi säger inget om sömnen`,
      source: "github",
    });
  }

  if (s.earlyBird) {
    cards.push({
      id: "early_bird",
      emoji: "🐦",
      title: "Morgonfågeln",
      subtitle: "Tidigaste commit före 07:00",
      winner: fmtName(s.earlyBird.login),
      stat: s.earlyBird.hour,
      statLabel: "Stockholm",
      detail: `${s.earlyBird.repo.split("/").pop()} — kaffet hade inte ens hunnit kallna`,
      source: "github",
    });
  }

  if (s.fastestReviewer) {
    cards.push({
      id: "fast_reviewer",
      emoji: "⚡",
      title: "Snabbaste granskaren",
      subtitle: "Kortaste median-tid till review",
      winner: fmtName(s.fastestReviewer.login),
      stat: fmtHours(s.fastestReviewer.hours),
      statLabel: "median",
      detail: `${s.fastestReviewer.reviewCount} reviews · minst 2 för att räknas`,
      source: "github",
    });
  }

  if (s.thoughtfulReviewer && s.thoughtfulReviewer.login !== s.fastestReviewer?.login) {
    cards.push({
      id: "thoughtful_reviewer",
      emoji: "🧠",
      title: "Den fundersamma",
      subtitle: "Längsta median-tid till review",
      winner: fmtName(s.thoughtfulReviewer.login),
      stat: fmtHours(s.thoughtfulReviewer.hours),
      statLabel: "median",
      detail: "Kvalitet tar tid — och det är helt okej",
      source: "github",
    });
  }

  if (s.longestFirstReview) {
    cards.push({
      id: "longest_review_wait",
      emoji: "⏳",
      title: "Veckans längsta väntan",
      subtitle: "PR som fick review senast efter öppning",
      winner: fmtName(s.longestFirstReview.reviewer),
      stat: fmtHours(s.longestFirstReview.hours),
      statLabel: "tills review",
      detail: `"${s.longestFirstReview.pr.slice(0, 50)}…"`,
      source: "github",
    });
  }

  if (s.mergesByUser?.size) {
    const [login, count] = [...s.mergesByUser.entries()].sort((a, b) => b[1] - a[1])[0];
    cards.push({
      id: "merge_master",
      emoji: "🔀",
      title: "Merge-mästaren",
      subtitle: "Flest mergade PR:ar",
      winner: fmtName(login),
      stat: count,
      statLabel: "merges",
      detail: "Den som tryckte på den gröna knappen mest",
      source: "github",
    });
  }

  if (s.prsOpenedByUser?.size) {
    const [login, count] = [...s.prsOpenedByUser.entries()].sort((a, b) => b[1] - a[1])[0];
    cards.push({
      id: "pr_opener",
      emoji: "📝",
      title: "PR-fabriken",
      subtitle: "Flest mergade PR:ar öppnade",
      winner: fmtName(login),
      stat: count,
      statLabel: "PR:ar",
      detail: "Shipping mindset",
      source: "github",
    });
  }

  if (s.issuesClosedByUser?.size) {
    const [login, count] = [...s.issuesClosedByUser.entries()].sort((a, b) => b[1] - a[1])[0];
    cards.push({
      id: "bug_hunter",
      emoji: "🐛",
      title: "Bug-jägaren",
      subtitle: "Flest stängda issues",
      winner: fmtName(login),
      stat: count,
      statLabel: "issues",
      detail: "Städade bordet i backlogen",
      source: "github",
    });
  }

  if (s.commitsByRepo?.size) {
    const [repo, count] = [...s.commitsByRepo.entries()].sort((a, b) => b[1] - a[1])[0];
    cards.push({
      id: "repo_of_week",
      emoji: "📦",
      title: "Veckans heta repo",
      subtitle: "Mest commit-aktivitet",
      winner: repo.split("/").pop(),
      stat: count,
      statLabel: "commits",
      detail: repo,
      source: "github",
    });
  }

  if (s.ciRunsByRepo?.size) {
    const [repo, count] = [...s.ciRunsByRepo.entries()].sort((a, b) => b[1] - a[1])[0];
    cards.push({
      id: "ci_champion",
      emoji: "🚀",
      title: "CI-maratonet",
      subtitle: "Repo med flest GitHub Actions-körningar",
      winner: repo.split("/").pop(),
      stat: count,
      statLabel: "körningar",
      detail: `${repo} — pipelinen fick träna`,
      source: "github",
    });
  }

  return cards;
}
