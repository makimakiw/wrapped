import { exec, execSync } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/** Read Azure DevOps PAT from macOS git credential keychain (no token logged). */
export function getAzurePatFromKeychain() {
  if (process.env.AZURE_DEVOPS_EXT_PAT) {
    return process.env.AZURE_DEVOPS_EXT_PAT;
  }
  try {
    const out = execSync("git credential-osxkeychain get", {
      input: "protocol=https\nhost=dev.azure.com\n\n",
      encoding: "utf8",
    });
    const match = out.match(/^password=(.+)$/m);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function hasM365Session() {
  try {
    const out = execSync("m365 status", { encoding: "utf8" });
    return !out.includes("Logged out");
  } catch {
    return false;
  }
}

export function m365Json(args) {
  const out = execSync(`m365 ${args} --output json`, {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  return JSON.parse(out);
}

export async function m365JsonAsync(args) {
  const { stdout } = await execAsync(`m365 ${args} --output json`, {
    maxBuffer: 50 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}
