import { hasM365Session, m365Json, m365JsonAsync } from "./credentials.mjs";

function inRange(iso, from, to) {
  const d = iso?.slice(0, 10);
  return d && d >= from && d <= to;
}

function isExcludedChannel(name, config) {
  const patterns = config.teams?.excludePatterns ?? [];
  const hay = String(name ?? "").toLowerCase();
  return patterns.some((p) => hay.includes(String(p).toLowerCase()));
}

export function stripHtml(html) {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/<at[^>]*>.*?<\/at>/gi, "")
    .replace(/\\+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const BORING =
  /^(ok|okej|done|fix|fixed|merged|lgtm|\+1|thanks|tack|toppen|bra|nice|snyggt|👍|🙏)$/i;

function scoreMessage(m) {
  const t = m.text;
  let score = 80 - Math.abs(t.length - 70) * 0.4;

  if (t.length < 15 || t.length > 200) score -= 40;
  if (t.length > 130) score -= 25;
  if (/^https?:\/\//.test(t)) score -= 80;
  if (/https?:\/\//.test(t)) score -= 35;
  if (BORING.test(t)) score -= 100;
  if ((t.match(/\?/g) ?? []).length >= 3) score -= 30;
  if (!/[a-zåäöA-ZÅÄÖ]{4,}/.test(t)) score -= 50;
  if (/\b(threshold|recipient|devices|endpoint|deploy|simulera|offline)\b/i.test(t))
    score -= 25;

  if (t.includes("!")) score += 14;
  if (/\b(FLAWLESS|ship it|skitsnack|legend|epic|aight|sömn|hehe|haha)\b/i.test(t))
    score += 35;
  if (t.split(" ").length >= 6 && t.split(" ").length <= 18) score += 12;
  if (/[A-ZÅÄÖ]{4,}/.test(t)) score += 10;
  if (m.source === "chat") score += 4;
  if (m.reactions?.length) score += m.reactions.length * 10;
  if (/\b(victory|vinst|ship(ped)?|live|deployed|klart|levererat)\b/i.test(t)) score += 28;
  if (/\(en favorit från arkivet\)/i.test(t)) score -= 100;

  return score;
}

function stripUrls(text) {
  return String(text ?? "")
    .replace(/https?:\/\/[^\s<>"')\]]+/gi, "")
    .replace(/\bwww\.[^\s<>"')\]]+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function trimQuote(text, max = 120) {
  let t = text.replace(/\s*…\s*$/, "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > 50 ? cut.slice(0, sp) : cut) + "…";
}

export function cleanQuoteText(text) {
  return trimQuote(
    stripUrls(text)
      .replace(/\s*\(?en favorit från arkivet\)?\s*/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function messageKey(m) {
  return `${m.author}|${m.text.slice(0, 100)}`;
}

function isVictoryText(text) {
  return /\b(flawless|ship it|ship(ped)?|(?:går|åker vi)\s+live|legend|epic|aight|vinst|klart|levererat|deployed)\b/i.test(
    text
  );
}

function victoryScore(text) {
  let s = 0;
  const t = text.toLowerCase();
  if (/ship it|flawless/.test(t)) s += 60;
  if (/live|åker vi live/.test(t)) s += 45;
  if (/aight|legend|epic/.test(t)) s += 25;
  if (t.includes("!")) s += 10;
  return s;
}

const REACTION_EMOJI = {
  like: "👍",
  heart: "❤️",
  laugh: "😂",
  surprised: "😮",
  sad: "😢",
  angry: "😠",
};

function extractEmojis(text) {
  const found = text.match(/\p{Extended_Pictographic}/gu);
  return [...new Set(found ?? [])].slice(0, 6);
}

export function summarizeReactions(reactions) {
  if (!reactions?.length) return null;
  const byType = new Map();
  for (const r of reactions) {
    const key = r.reactionType ?? r.type ?? "like";
    byType.set(key, (byType.get(key) ?? 0) + 1);
  }
  const items = [...byType.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([type, count]) => ({
      emoji: REACTION_EMOJI[type] ?? "👍",
      count,
    }));
  return { total: reactions.length, items };
}

function vibeEmojis(text) {
  const t = String(text).toLowerCase();
  if (/\b(flawless|ship it|live|legend|epic|vinst)\b/.test(t)) {
    return ["🏆", "🔥", "👏", "🚀"];
  }
  if (/\b(hehe|haha|skitsnack|aight)\b/.test(t)) {
    return ["😂", "😂", "👍", "💬"];
  }
  if (/!/.test(t)) return ["🔥", "👍", "😂", "❤️"];
  return ["👍", "❤️", "😂", "🔥"];
}

function padEmojis(emojis, text) {
  const pool = [...emojis, ...vibeEmojis(text)];
  const out = [];
  for (const e of pool) {
    if (!out.includes(e)) out.push(e);
    if (out.length >= 4) break;
  }
  const fallback = ["👍", "❤️", "😂", "🔥"];
  for (const e of fallback) {
    if (out.length >= 4) break;
    if (!out.includes(e)) out.push(e);
  }
  return out.slice(0, 4);
}

function reactionDisplay(quote) {
  const plain = quote.text.replace(/^"|"$/g, "");
  if (quote.reactions?.items?.length) {
    return {
      total: Math.max(quote.reactions.total, 4),
      emojis: padEmojis(quote.reactions.items.map((i) => i.emoji), plain),
    };
  }
  const fromText = quote.emojisInText?.length ? quote.emojisInText : vibeEmojis(plain);
  const total = Math.max(4, Math.round((quote.score ?? 50) / 6));
  return {
    total,
    emojis: padEmojis(fromText, plain),
  };
}

function toQuote(m) {
  const plain = m.text;
  const text = cleanQuoteText(plain);
  const channel =
    m.channel.split("/").pop()?.trim() ?? m.channel ?? m.chatTopic ?? "Teams";
  const score = m.score ?? scoreMessage(m);
  const quote = {
    text: `"${text}"`,
    author: m.author,
    channel,
    context: m.source === "chat" ? `Ur ${m.chatTopic ?? channel}` : `Ur ${m.channel}`,
    score,
    reactions: summarizeReactions(m.reactions),
    emojisInText: extractEmojis(plain),
  };
  return { ...quote, reactionDisplay: reactionDisplay(quote) };
}

function buildQuoteCard(m, meta) {
  const q = toQuote(m);
  return {
    kind: meta.kind,
    cardTitle: meta.cardTitle,
    cardEmoji: meta.cardEmoji,
    ...q,
  };
}

/** Tre Teams-kort: flest reaktioner, ett victory moment, mest aktiv i chatt. */
export function pickTeamCards(messages) {
  const prepared = messages
    .map((m) => ({ ...m, text: stripHtml(m.text) }))
    .filter((m) => m.text.length >= 12 && !m.text.includes("<systemEventMessage"))
    .map((m) => ({ ...m, score: scoreMessage(m) }));

  const cards = [];
  const used = new Set();
  const free = (m) => !used.has(messageKey(m));
  const mark = (m) => used.add(messageKey(m));

  const reactPool = prepared
    .filter(free)
    .filter((m) => !/\(en favorit från arkivet\)/i.test(m.text))
    .sort((a, b) => {
      const dr = (b.reactions?.length ?? 0) - (a.reactions?.length ?? 0);
      return dr !== 0 ? dr : (b.score ?? 0) - (a.score ?? 0);
    });

  const reactionMsg =
    reactPool.find((m) => (m.reactions?.length ?? 0) > 0) ?? reactPool[0];
  if (reactionMsg) {
    cards.push(
      buildQuoteCard(reactionMsg, {
        kind: "reactions",
        cardTitle: "Flest reaktioner",
        cardEmoji: "🔥",
      })
    );
    mark(reactionMsg);
  }

  const victoryMsg = prepared
    .filter(free)
    .filter((m) => isVictoryText(m.text))
    .sort((a, b) => victoryScore(b.text) - victoryScore(a.text))[0];
  if (victoryMsg) {
    cards.push(
      buildQuoteCard(victoryMsg, {
        kind: "victory",
        cardTitle: "Victory moment",
        cardEmoji: "🏆",
      })
    );
    mark(victoryMsg);
  }

  const chatMsgs = prepared.filter((m) => m.source === "chat");
  const byAuthor = new Map();
  const channelCounts = new Map();
  for (const m of chatMsgs) {
    byAuthor.set(m.author, (byAuthor.get(m.author) ?? 0) + 1);
    const ch = m.chatTopic ?? m.channel;
    const ck = `${m.author}\0${ch}`;
    channelCounts.set(ck, (channelCounts.get(ck) ?? 0) + 1);
  }

  const topAuthor = topEntry(byAuthor);
  if (topAuthor) {
    const [author, count] = topAuthor;
    let topChannel = null;
    let topChCount = 0;
    for (const [key, n] of channelCounts) {
      const [a, ch] = key.split("\0");
      if (a !== author || n <= topChCount) continue;
      topChCount = n;
      topChannel = ch;
    }
    cards.push({
      kind: "chat_star",
      cardTitle: "Mest aktiv i chattarna",
      cardEmoji: "🗣️",
      author,
      stat: count,
      statLabel: "meddelanden",
      subtitle: topChannel ?? "Gruppchattar",
      detail: `${count} meddelanden · ${topChannel ?? "Teams-chattar"}`,
    });
  }

  return cards;
}

function topEntry(map) {
  if (!map?.size) return null;
  return [...map.entries()].sort((a, b) => b[1] - a[1])[0];
}

export function pickQuotes(messages) {
  const teamCards = pickTeamCards(messages);
  return {
    quote: teamCards.find((c) => c.kind === "reactions") ?? null,
    highlights: teamCards.filter((c) => c.kind === "victory"),
    teamCards,
    teamQuotes: teamCards.filter((c) => c.kind !== "chat_star"),
  };
}

async function mapPool(items, fn, concurrency = 12) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i], i);
      } catch {
        results[i] = null;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results.flat().filter(Boolean);
}

async function fetchChannelMessages(config, teams, period, nameFilter) {
  const scoped = nameFilter
    ? teams.filter((t) => t.displayName?.toLowerCase().includes(nameFilter))
    : teams;

  const jobs = [];
  for (const team of scoped) {
    let channels = [];
    try {
      channels = m365Json(`teams channel list --teamId ${team.id}`);
    } catch {
      continue;
    }
    for (const channel of channels) {
      jobs.push({ team, channel });
    }
  }

  const rows = await mapPool(jobs, async ({ team, channel }) => {
    const msgs = await m365JsonAsync(
      `teams message list --teamId ${team.id} --channelId ${channel.id} --since ${period.from}`
    );
    const out = [];
    for (const msg of msgs) {
      const created = msg.createdDateTime ?? msg.lastModifiedDateTime;
      if (!inRange(created, period.from, period.to)) continue;
      if (msg.messageType && msg.messageType !== "message") continue;
      const author =
        msg.from?.user?.displayName ?? msg.from?.application?.displayName ?? null;
      const body = msg.body?.content ?? "";
      if (!author || !stripHtml(body)) continue;
      const chKey = `${team.displayName} / ${channel.displayName}`;
      if (isExcludedChannel(chKey, config)) continue;
      out.push({
        author,
        channel: chKey,
        created,
        text: body,
        source: "channel",
        reactions: msg.reactions ?? [],
      });
    }
    return out;
  });

  return { messages: rows, channelsScanned: jobs.length, teamsScanned: scoped.length };
}

async function fetchGroupChatMessages(config, period) {
  const chats = m365Json("teams chat list");
  const groups = chats.filter((c) => c.chatType === "group");
  const start = `${period.from}T00:00:00Z`;
  const end = `${period.to}T23:59:59Z`;

  const rows = await mapPool(groups, async (chat) => {
    const chatId = chat.id;
    const topic = chat.topic?.trim() || "Gruppchatt";
    if (isExcludedChannel(topic, config)) return [];
    let msgs;
    try {
      msgs = await m365JsonAsync(
        `teams chat message list --chatId "${chatId}" --modifiedStartDateTime ${start} --modifiedEndDateTime ${end}`
      );
    } catch {
      return [];
    }

    const out = [];
    for (const msg of msgs) {
      const created = msg.createdDateTime ?? msg.lastModifiedDateTime;
      if (!inRange(created, period.from, period.to)) continue;
      if (msg.messageType && msg.messageType !== "message") continue;
      const author = msg.from?.user?.displayName ?? null;
      const body = msg.body?.content ?? "";
      if (!author || !stripHtml(body)) continue;
      out.push({
        author,
        channel: topic,
        chatTopic: topic,
        created,
        text: body,
        source: "chat",
        reactions: msg.reactions ?? [],
      });
    }
    return out;
  });

  return { messages: rows, groupChatsScanned: groups.length };
}

export async function fetchTeams(config, { from, to }) {
  const period = { from, to };
  const result = {
    status: "unavailable",
    real: false,
    messages: [],
    quote: null,
    highlights: [],
    reason: null,
  };

  if (!hasM365Session()) {
    result.reason =
      "Inte inloggad i M365. Kör: m365 login --authType deviceCode";
    return result;
  }

  try {
    const teams = m365Json("teams team list");
    const nameFilter = config.teams?.scanAllTeams
      ? null
      : config.teams?.nameIncludes?.toLowerCase() ?? null;

    console.log("  Teams-kanaler…");
    const channelData = await fetchChannelMessages(config, teams, period, nameFilter);

    let chatData = { messages: [], groupChatsScanned: 0 };
    if (config.teams?.scanGroupChats !== false) {
      console.log("  Gruppchattar (kan ta ~1 min)…");
      chatData = await fetchGroupChatMessages(config, period);
    }

    result.messages = [...channelData.messages, ...chatData.messages];

    const messagesByAuthor = new Map();
    const messagesByChannel = new Map();
    const messagesByChannelAuthor = new Map();
    for (const m of result.messages) {
      messagesByAuthor.set(m.author, (messagesByAuthor.get(m.author) ?? 0) + 1);
      messagesByChannel.set(m.channel, (messagesByChannel.get(m.channel) ?? 0) + 1);
      if (!messagesByChannelAuthor.has(m.channel)) {
        messagesByChannelAuthor.set(m.channel, new Map());
      }
      const byAuthor = messagesByChannelAuthor.get(m.channel);
      byAuthor.set(m.author, (byAuthor.get(m.author) ?? 0) + 1);
    }

    const quotes = pickQuotes(result.messages);
    result.quote = quotes.quote;
    result.highlights = quotes.highlights;
    result.teamCards = quotes.teamCards;
    result.teamQuotes = quotes.teamQuotes;
    result.stats = {
      messagesByAuthor,
      messagesByChannel,
      messagesByChannelAuthor,
      totalMessages: result.messages.length,
      channelMessages: channelData.messages.length,
      chatMessages: chatData.messages.length,
      teamsScanned: channelData.teamsScanned,
      channelsScanned: channelData.channelsScanned,
      groupChatsScanned: chatData.groupChatsScanned,
    };
    result.status = "ok";
    result.real = true;
  } catch (e) {
    result.status = "error";
    result.reason = String(e.message ?? e);
  }

  return result;
}
