const MONTHS_SV = [
  "januari",
  "februari",
  "mars",
  "april",
  "maj",
  "juni",
  "juli",
  "augusti",
  "september",
  "oktober",
  "november",
  "december",
];

function formatDateInTz(date, timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function parseIsoParts(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day };
}

export function formatPeriodLabel(from, to) {
  const a = parseIsoParts(from);
  const b = parseIsoParts(to);

  if (a.year === b.year && a.month === b.month) {
    return `${a.day}–${b.day} ${MONTHS_SV[a.month - 1]} ${a.year}`;
  }

  if (a.year === b.year) {
    return `${a.day} ${MONTHS_SV[a.month - 1]}–${b.day} ${MONTHS_SV[b.month - 1]} ${a.year}`;
  }

  return `${a.day} ${MONTHS_SV[a.month - 1]} ${a.year}–${b.day} ${MONTHS_SV[b.month - 1]} ${b.year}`;
}

/** Rolling window ending today in the given timezone (includes weekends). */
export function computeRollingPeriod({
  days = 7,
  timezone = "Europe/Stockholm",
  anchorDate = new Date(),
} = {}) {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`period days must be a positive integer, got ${days}`);
  }

  const to = formatDateInTz(anchorDate, timezone);
  const start = new Date(anchorDate);
  start.setDate(start.getDate() - (days - 1));
  const from = formatDateInTz(start, timezone);

  return {
    from,
    to,
    label: formatPeriodLabel(from, to),
    days,
    timezone,
  };
}
