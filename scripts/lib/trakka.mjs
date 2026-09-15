import { excludeLeave, trakka, weekdayDates } from "./utils.mjs";

export function fetchTrakka({ from, to }) {
  const result = { status: "pending", entries: [], allocations: [] };

  try {
    result.entries = trakka(`logs --from ${from} --to ${to} --format json`).entries ?? [];
    result.status = "ok";
  } catch (e) {
    result.status = "error";
    result.error = String(e.message ?? e);
    return result;
  }

  try {
    const month = from.slice(0, 7);
    result.allocations = trakka(`allocations --month ${month}`).allocations ?? [];
  } catch {
    result.allocations = [];
  }

  return result;
}

export function computeTrakkaStats(trk, { from, to }) {
  const workDays = weekdayDates(from, to);

  const hoursByPerson = new Map();
  const workHoursByPerson = new Map();
  const hoursByProject = new Map();
  const customerHoursByPerson = new Map();
  const customerHoursByClient = new Map();
  const internalHoursByPerson = new Map();
  const projectsByPerson = new Map();
  const daysByPerson = new Map();

  for (const e of trk.entries) {
    hoursByPerson.set(e.personName, (hoursByPerson.get(e.personName) ?? 0) + e.hours);

    if (excludeLeave(e)) {
      workHoursByPerson.set(
        e.personName,
        (workHoursByPerson.get(e.personName) ?? 0) + e.hours
      );
      if (!daysByPerson.has(e.personName)) daysByPerson.set(e.personName, new Set());
      daysByPerson.get(e.personName).add(e.date);

      if (e.client?.type === "customer") {
        customerHoursByPerson.set(
          e.personName,
          (customerHoursByPerson.get(e.personName) ?? 0) + e.hours
        );
        const clientName = e.client.name ?? "Kund";
        customerHoursByClient.set(
          clientName,
          (customerHoursByClient.get(clientName) ?? 0) + e.hours
        );
      } else if (e.client) {
        internalHoursByPerson.set(
          e.personName,
          (internalHoursByPerson.get(e.personName) ?? 0) + e.hours
        );
      }

      if (e.item?.kind === "project") {
        hoursByProject.set(e.item.name, (hoursByProject.get(e.item.name) ?? 0) + e.hours);
        if (!projectsByPerson.has(e.personName)) projectsByPerson.set(e.personName, new Set());
        projectsByPerson.get(e.personName).add(e.item.name);
      }
    }
  }

  trk.stats = {
    workHoursByPerson,
    hoursByProject,
    customerHoursByPerson,
    customerHoursByClient,
    internalHoursByPerson,
    projectsByPerson,
    daysByPerson,
    workDays,
  };
  return trk;
}
