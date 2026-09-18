#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeRollingPeriod } from "./lib/period.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CONFIG_PATH = join(__dirname, "config.json");

function run(cmd, opts = {}) {
  execSync(cmd, { cwd: ROOT, stdio: "inherit", ...opts });
}

function runCapture(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim();
}

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
const timezone = config.timezone ?? "Europe/Stockholm";
const days = config.periodDays ?? 7;
const period = computeRollingPeriod({ days, timezone });

config.period = period;
writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);

console.log(`\n=== Weekly refresh ===`);
console.log(`Period: ${period.label} (${period.from} → ${period.to})\n`);

run("node scripts/build.mjs");

const status = runCapture("git status --porcelain scripts/config.json public/data/wrapped.json");
if (!status) {
  console.log("\nNo data changes to commit.");
} else {
  run("git add scripts/config.json public/data/wrapped.json");
  run(`git commit -m "Weekly wrap: ${period.label}"`);
  run("git push origin main");
  console.log("\nPushed updated wrap data.");
}

try {
  run("vercel deploy --prod --yes");
} catch (error) {
  console.error("\nVercel deploy failed — data is still committed locally/remotely if push succeeded.");
  throw error;
}

console.log("\n=== Weekly refresh complete ===");
