import { getAzurePatFromKeychain } from "./credentials.mjs";
import { inPeriod, run } from "./utils.mjs";

async function azureFetch(path, pat, org) {
  const auth = Buffer.from(`:${pat}`).toString("base64");
  const url = path.startsWith("http")
    ? path
    : `https://dev.azure.com/${org}/${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Azure ${res.status}`);
  return res.json();
}

function hasAzCli() {
  try {
    run("command -v az");
    run("az account show");
    return true;
  } catch {
    return false;
  }
}

export async function fetchAzure(config, { from, to }) {
  const org = config.azure?.org ?? "thirdact";
  const pat = getAzurePatFromKeychain();
  const result = {
    status: "unavailable",
    real: false,
    org,
    mergedPrs: [],
    pipelineRuns: [],
    reason: null,
  };

  if (!pat && !hasAzCli()) {
    result.reason =
      "Ingen Azure-auth. Keychain (dev.azure.com), AZURE_DEVOPS_EXT_PAT eller az login.";
    return result;
  }

  try {
    let projects = [];
    if (pat) {
      const data = await azureFetch(
        `_apis/projects?api-version=7.1&$top=100`,
        pat,
        org
      );
      projects = data.value ?? [];
    } else {
      const raw = run(
        `az devops project list --organization https://dev.azure.com/${org} --output json`
      );
      projects = JSON.parse(raw).value ?? [];
    }

    result.projects = projects.length;
    result.authMethod = pat ? "keychain" : "az-cli";

    for (const project of projects) {
      const proj = project.name;
      try {
        let prs = [];
        if (pat) {
          const data = await azureFetch(
            `${encodeURIComponent(proj)}/_apis/git/pullrequests?searchCriteria.status=completed&api-version=7.1&$top=200`,
            pat,
            org
          );
          prs = data.value ?? [];
        } else {
          const raw = run(
            `az repos pr list --project "${proj}" --status completed --organization https://dev.azure.com/${org} --output json`
          );
          prs = JSON.parse(raw);
        }

        for (const pr of prs) {
          const closed = pr.closedDate ?? pr.completionQueueTime;
          if (inPeriod(closed, from, to)) {
            result.mergedPrs.push({ ...pr, projectName: proj });
          }
        }
      } catch {
        /* skip project PRs */
      }

      try {
        if (pat) {
          const data = await azureFetch(
            `${encodeURIComponent(proj)}/_apis/pipelines/runs?minTime=${from}T00:00:00Z&maxTime=${to}T23:59:59Z&api-version=7.1&$top=200`,
            pat,
            org
          );
          for (const r of data.value ?? []) {
            result.pipelineRuns.push({ ...r, projectName: proj });
          }
        }
      } catch {
        /* pipelines optional */
      }
    }

    result.status = "ok";
    result.real = true;
    delete result.reason;
  } catch (e) {
    result.status = "error";
    result.reason = String(e.message ?? e);
  }

  return result;
}

export function azureCards(az) {
  if (!az.real || az.status !== "ok") return [];

  const cards = [];
  const mergesByCreator = new Map();

  for (const pr of az.mergedPrs) {
    const name =
      pr.createdBy?.displayName ??
      pr.createdBy?.uniqueName?.split("@")[0] ??
      "Okänd";
    mergesByCreator.set(name, (mergesByCreator.get(name) ?? 0) + 1);
  }

  if (mergesByCreator.size) {
    const [name, count] = [...mergesByCreator.entries()].sort(
      (a, b) => b[1] - a[1]
    )[0];
    cards.push({
      id: "azure_pr_champion",
      emoji: "☁️",
      title: "Azure PR-kungen",
      subtitle: "Flest mergade PR:ar i Azure DevOps",
      winner: name,
      stat: count,
      statLabel: "PR:ar",
      detail: `dev.azure.com/${az.org} · ${az.mergedPrs.length} totalt`,
      source: "azure",
    });
  }

  if (az.pipelineRuns.length) {
    const byProject = new Map();
    for (const r of az.pipelineRuns) {
      const p = r.projectName ?? "unknown";
      byProject.set(p, (byProject.get(p) ?? 0) + 1);
    }
    const [project, count] = [...byProject.entries()].sort(
      (a, b) => b[1] - a[1]
    )[0];
    cards.push({
      id: "azure_pipeline",
      emoji: "🛠️",
      title: "Pipeline-proffset",
      subtitle: "Flest Azure pipeline-körningar",
      winner: project,
      stat: count,
      statLabel: "körningar",
      detail: "Build, test, repeat",
      source: "azure",
    });
  }

  if (az.projects && !mergesByCreator.size && !az.pipelineRuns.length) {
    cards.push({
      id: "azure_quiet",
      emoji: "☁️",
      title: "Azure lugn vecka",
      subtitle: "Inga mergade PR:ar eller pipelines",
      winner: `${az.projects} projekt`,
      stat: "0",
      statLabel: "merges",
      detail: "Antingen lugn vecka eller all action på GitHub",
      source: "azure",
    });
  }

  return cards;
}
