import { inPeriod } from "./utils.mjs";

const API = "https://api.cursor.com";

function basicAuth(key) {
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

async function cursorFetch(path, { key, method = "GET", body, auth = "basic" }) {
  const headers = { Accept: "application/json" };
  if (body) headers["Content-Type"] = "application/json";
  if (auth === "basic") headers.Authorization = basicAuth(key);
  else headers.Authorization = `Bearer ${key}`;

  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

function periodMs(from, to) {
  const start = new Date(`${from}T00:00:00.000Z`).getTime();
  const end = new Date(`${to}T23:59:59.999Z`).getTime();
  return { start, end };
}

export function previousPeriod({ from, to }) {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  const days = Math.round((end - start) / 86_400_000) + 1;
  const prevEnd = new Date(start);
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevStart.getUTCDate() - (days - 1));
  return {
    from: prevStart.toISOString().slice(0, 10),
    to: prevEnd.toISOString().slice(0, 10),
  };
}

function emailName(email) {
  if (!email) return "Okänd";
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._-]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function aiRequests(row) {
  return (row.agentRequests ?? 0) + (row.composerRequests ?? 0) + (row.chatRequests ?? 0);
}

function aggregateTeamUsage(rows) {
  const byEmail = new Map();
  const models = new Map();
  const extensions = new Map();

  for (const row of rows) {
    const email = row.email ?? `user-${row.userId}`;
    if (!byEmail.has(email)) {
      byEmail.set(email, {
        email,
        name: emailName(email),
        agentRequests: 0,
        chatRequests: 0,
        composerRequests: 0,
        acceptedLinesAdded: 0,
        totalTabsAccepted: 0,
        bugbotUsages: 0,
        activeDays: 0,
      });
    }
    const u = byEmail.get(email);
    u.agentRequests += row.agentRequests ?? 0;
    u.chatRequests += row.chatRequests ?? 0;
    u.composerRequests += row.composerRequests ?? 0;
    u.acceptedLinesAdded += row.acceptedLinesAdded ?? 0;
    u.totalTabsAccepted += row.totalTabsAccepted ?? 0;
    u.bugbotUsages += row.bugbotUsages ?? 0;
    if (row.isActive !== false) u.activeDays += 1;

    if (row.mostUsedModel) {
      models.set(row.mostUsedModel, (models.get(row.mostUsedModel) ?? 0) + aiRequests(row));
    }
    const ext = row.applyMostUsedExtension ?? row.tabMostUsedExtension;
    if (ext) extensions.set(ext, (extensions.get(ext) ?? 0) + 1);
  }

  const userAi = (u) => u.agentRequests + u.composerRequests + u.chatRequests;
  const rankedUsers = [...byEmail.values()].sort((a, b) => userAi(b) - userAi(a));
  const topUser = rankedUsers[0] ?? null;
  const topUsers = rankedUsers
    .filter((u) => userAi(u) > 0)
    .slice(0, 4)
    .map((u) => ({
      name: u.name,
      email: u.email,
      requests: userAi(u),
    }));

  const totalAi = rankedUsers.reduce((s, u) => s + userAi(u), 0);
  const topModels = [...models.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, requests]) => ({
      name,
      requests,
      share: totalAi > 0 ? Math.round((requests / totalAi) * 100) : 0,
    }));

  const topModel = topModels[0]?.name ?? null;
  const topExt = [...extensions.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    users: byEmail,
    topUser,
    topUsers,
    topModel,
    topModels,
    topExt,
    totals: {
      agentRequests: [...byEmail.values()].reduce((s, u) => s + u.agentRequests, 0),
      chatRequests: [...byEmail.values()].reduce((s, u) => s + u.chatRequests, 0),
      composerRequests: [...byEmail.values()].reduce((s, u) => s + u.composerRequests, 0),
      aiRequests: totalAi,
      acceptedLinesAdded: [...byEmail.values()].reduce(
        (s, u) => s + u.acceptedLinesAdded,
        0
      ),
      tabsAccepted: [...byEmail.values()].reduce((s, u) => s + u.totalTabsAccepted, 0),
      bugbotUsages: [...byEmail.values()].reduce((s, u) => s + u.bugbotUsages, 0),
      activeUsers: byEmail.size,
    },
  };
}

export function pctChange(current, previous) {
  if (previous == null || previous === 0) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 100);
}

export function buildWeekCompare(current, previous) {
  const cur = current.totals;
  const prev = previous?.totals;
  return {
    aiRequests: pctChange(cur.aiRequests, prev?.aiRequests),
    lines: pctChange(cur.acceptedLinesAdded, prev?.acceptedLinesAdded),
    tabs: pctChange(cur.tabsAccepted, prev?.tabsAccepted),
    activeUsers: pctChange(cur.activeUsers, prev?.activeUsers),
    previousAiRequests: prev?.aiRequests ?? 0,
    previousLines: prev?.acceptedLinesAdded ?? 0,
  };
}

async function fetchTeamUsage(key, period) {
  const { start, end } = periodMs(period.from, period.to);
  const res = await cursorFetch("/teams/daily-usage-data", {
    key,
    method: "POST",
    auth: "basic",
    body: { startDate: start, endDate: end, page: 1, pageSize: 1000 },
  });

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      reason:
        res.status === 401
          ? "Inte en Team Admin-nyckel (admin:*)"
          : res.json?.message ?? `HTTP ${res.status}`,
    };
  }

  const rows = (res.json?.data ?? []).filter((row) =>
    inPeriod(row.day ?? new Date(row.date).toISOString(), period.from, period.to)
  );

  return { ok: true, rows, stats: aggregateTeamUsage(rows), period };
}

async function fetchCloudAgents(key, period) {
  const meRes = await cursorFetch("/v1/me", { key, auth: "bearer" });
  if (!meRes.ok) {
    return {
      ok: false,
      status: meRes.status,
      reason: meRes.json?.message ?? `HTTP ${meRes.status}`,
    };
  }

  const agentsRes = await cursorFetch("/v1/agents?limit=100", { key, auth: "bearer" });
  const agents = agentsRes.json?.items ?? [];

  const inWeek = agents.filter(
    (a) =>
      inPeriod(a.createdAt, period.from, period.to) ||
      inPeriod(a.updatedAt, period.from, period.to)
  );

  let totalTokens = 0;
  let totalCostCents = 0;
  const agentDetails = [];

  for (const agent of inWeek) {
    const usageRes = await cursorFetch(`/v1/agents/${agent.id}/usage`, {
      key,
      auth: "bearer",
    });
    const usage = usageRes.json?.totalUsage ?? {};
    const cost = usageRes.json?.cost?.chargedCents ?? 0;
    totalTokens += usage.totalTokens ?? 0;
    totalCostCents += cost;
    agentDetails.push({
      id: agent.id,
      name: agent.name,
      status: agent.status,
      createdAt: agent.createdAt,
      totalTokens: usage.totalTokens ?? 0,
      runs: usageRes.json?.runs?.length ?? 0,
    });
  }

  const reposRes = await cursorFetch("/v1/repositories", { key, auth: "bearer" });
  const repos = (reposRes.json?.items ?? []).map((r) => r.url).filter(Boolean);
  const orgRepos = repos.filter((url) => url.includes("/third-act/"));

  return {
    ok: true,
    me: meRes.json,
    agents: agentDetails,
    agentCount: inWeek.length,
    totalAgents: agents.length,
    totalTokens,
    totalCostCents,
    repos,
    orgRepos,
  };
}

export async function fetchCursor(config, period) {
  const key = process.env.CURSOR_API_KEY?.trim();
  const result = {
    status: "unavailable",
    real: false,
    mode: null,
    reason: null,
    stats: null,
    previousStats: null,
    compare: null,
    previousPeriod: null,
    me: null,
    org: config.org,
  };

  if (!key) {
    result.reason = "Saknar CURSOR_API_KEY (lägg i .env eller export).";
    return result;
  }

  const prevPeriod = previousPeriod(period);
  result.previousPeriod = prevPeriod;

  const [team, teamPrev] = await Promise.all([
    fetchTeamUsage(key, period),
    fetchTeamUsage(key, prevPeriod),
  ]);

  if (team.ok && team.rows.length) {
    result.status = "ok";
    result.real = true;
    result.mode = "team";
    result.stats = team.stats;
    result.rawCount = team.rows.length;
    if (teamPrev.ok && teamPrev.rows.length) {
      result.previousStats = teamPrev.stats;
      result.compare = buildWeekCompare(team.stats, teamPrev.stats);
    }
    return result;
  }

  if (team.ok && !team.rows.length) {
    result.teamEmpty = true;
  } else if (!team.ok && team.status !== 401) {
    result.reason = team.reason;
  }

  const cloud = await fetchCloudAgents(key, period);
  if (!cloud.ok) {
    result.reason =
      result.reason ??
      cloud.reason ??
      "Nyckeln fungerade varken som Team Admin eller Cloud Agents.";
    return result;
  }

  result.me = cloud.me;
  result.mode = "cloud";
  result.real = true;
  result.status = "ok";
  result.stats = {
    agentCount: cloud.agentCount,
    totalAgents: cloud.totalAgents,
    totalTokens: cloud.totalTokens,
    totalCostCents: cloud.totalCostCents,
    orgRepoCount: cloud.orgRepos.length,
    repoCount: cloud.repos.length,
    topAgent: cloud.agents.sort((a, b) => b.totalTokens - a.totalTokens)[0] ?? null,
    ownerName: [cloud.me?.userFirstName, cloud.me?.userLastName]
      .filter(Boolean)
      .join(" "),
    ownerEmail: cloud.me?.userEmail,
    orgRepos: cloud.orgRepos,
    teamHint:
      team.status === 401
        ? "För hela teamets Cursor-statistik: skapa en Admin-nyckel (admin:*) i Cursor Dashboard → API Keys."
        : null,
  };

  if (!cloud.agentCount && !cloud.orgRepos.length) {
    result.status = "empty";
    result.real = Boolean(cloud.me);
  }

  return result;
}
