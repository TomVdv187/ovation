/**
 * Pin the machine's TLS-interception root CA so Node keeps trusting it.
 *
 * AVG (and most corporate proxies) terminate TLS and re-sign with their own
 * root. Node 22 reads the Windows store, so this normally just works — until
 * the tool REGENERATES its CA, at which point every running process fails with
 * UNABLE_TO_VERIFY_LEAF_SIGNATURE until it is restarted. That is what stopped
 * Agent 7 · CRITIC from ever seeing an app render against real data, and it is
 * why the Playwright suite was written but never run.
 *
 *   node scripts/trust-local-tls.mjs      # then restart any dev server
 *
 * This pins a CA that is ALREADY in your machine's root store, making the trust
 * explicit and independent of Node's store integration. It does NOT weaken
 * verification. It is emphatically not NODE_TLS_REJECT_UNAUTHORIZED=0, which
 * turns certificate checking off entirely — never use that here.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts", "trust-local-tls.ps1");
const out = join(root, "certs", "tls-interception-root.pem");

if (process.platform !== "win32") {
  console.log("Not Windows — nothing to do. Export your proxy's root CA and");
  console.log("point NODE_EXTRA_CA_CERTS at it if TLS is intercepted here.");
  process.exit(0);
}

let pem = "";
try {
  pem = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
    { encoding: "utf8" },
  );
} catch (error) {
  console.error("Could not read the certificate store:", error.message);
  process.exit(1);
}

if (!pem.includes("BEGIN CERTIFICATE")) {
  console.log("No TLS-interception root found — nothing to pin.");
  console.log("If apps still fail with UNABLE_TO_VERIFY_LEAF_SIGNATURE, the");
  console.log("interceptor is not matching this script's name filter.");
  process.exit(0);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, pem.trim() + "\n", "ascii");

const count = (pem.match(/BEGIN CERTIFICATE/g) ?? []).length;
console.log(`Pinned ${count} certificate(s) to certs/tls-interception-root.pem`);
console.log("");
console.log("Make sure .env has:");
console.log('  NODE_EXTRA_CA_CERTS="./certs/tls-interception-root.pem"');
console.log("");
console.log("Then restart any running dev server.");
