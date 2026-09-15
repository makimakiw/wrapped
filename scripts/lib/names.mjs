import { run } from "./utils.mjs";

const cache = new Map();

export function createNameResolver(config) {
  return function fmtName(login) {
    if (!login || login === "unknown") return login;
    if (config.nameOverrides?.[login]) return config.nameOverrides[login];
    if (cache.has(login)) return cache.get(login);
    try {
      const user = JSON.parse(run(`gh api users/${login}`));
      const name = user.name || login;
      cache.set(login, name);
      return name;
    } catch {
      cache.set(login, login);
      return login;
    }
  };
}

export function createTimeHelpers(config) {
  function toStockholmHour(iso) {
    const parts = new Intl.DateTimeFormat("sv-SE", {
      timeZone: config.timezone,
      hour: "numeric",
      hour12: false,
    }).formatToParts(new Date(iso));
    return Number(parts.find((p) => p.type === "hour").value);
  }

  function toStockholmTime(iso) {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: config.timezone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  }

  return { toStockholmHour, toStockholmTime };
}
