import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Checks that nothing on the public pages overflows a phone.
 *
 *   pnpm --filter @ovation/events check:mobile
 *   pnpm --filter @ovation/events check:mobile http://localhost:3001 /e/some-slug
 *
 * A sideways scrollbar on a guest-facing page is the sort of thing that is
 * obvious on a device and invisible in a desktop browser, and no accessibility
 * audit catches it. This drives a headless Chrome over the debugging protocol,
 * lays each page out at 390x844, and reports any element wider than the
 * viewport along with the selector that did it.
 *
 * Needs a dev server running and Chrome installed. Point CHROME_PATH at the
 * binary if it is somewhere unusual.
 */

const VIEWPORT = { width: 390, height: 844 };

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter((p): p is string => Boolean(p));

const PROBE = `(() => {
  const doc = document.documentElement;
  const offenders = [];
  const limit = doc.clientWidth;
  for (const el of document.querySelectorAll("body *")) {
    const box = el.getBoundingClientRect();
    if (box.width === 0 || getComputedStyle(el).position === "fixed") continue;
    if (box.right > limit + 1 || box.left < -1) {
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className && String(el.className)).slice(0, 90),
        left: Math.round(box.left),
        right: Math.round(box.right),
      });
    }
  }
  return JSON.stringify({
    scrollWidth: doc.scrollWidth,
    clientWidth: doc.clientWidth,
    offenders: offenders.slice(0, 6),
  });
})()`;

async function main(): Promise<void> {
  const base = process.argv[2] ?? "http://localhost:3001";
  const paths =
    process.argv.length > 3
      ? process.argv.slice(3)
      : [
          "/",
          "/e/meridian-summit-2026",
          "/e/meridian-summit-2026/register",
          "/e/meridian-summit-2026/tickets",
          "/e/meridian-summit-2026/ticket",
        ];

  const binary = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!binary) {
    console.error(
      "No Chrome found. Set CHROME_PATH to the binary and try again.",
    );
    process.exit(1);
  }

  const port = 9222 + (process.pid % 500);
  const chrome = spawn(binary, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    `--remote-debugging-port=${port}`,
    "--user-data-dir=" + join(process.env.TEMP ?? "/tmp", `ov-mobile-${port}`),
    "about:blank",
  ]);
  chrome.on("error", (error) => {
    console.error("could not start Chrome:", error.message);
    process.exit(1);
  });

  let failures = 0;
  try {
    await waitForDevTools(port);

    for (const path of paths) {
      const result = await probe(port, `${base}${path}`);
      const overflow = result.scrollWidth > result.clientWidth + 1;
      if (overflow) failures++;
      console.log(
        `  ${overflow ? "FAIL" : "ok  "}  ${path}  ` +
          `(document ${result.scrollWidth}px in a ${result.clientWidth}px viewport)`,
      );
      for (const o of result.offenders) {
        console.log(`          <${o.tag} class="${o.cls}"> ${o.left}…${o.right}`);
      }
    }
  } finally {
    chrome.kill();
  }

  console.log(
    failures === 0
      ? `\nNothing overflows at ${VIEWPORT.width}px.\n`
      : `\n${failures} page(s) overflow.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

interface ProbeResult {
  scrollWidth: number;
  clientWidth: number;
  offenders: Array<{ tag: string; cls: string; left: number; right: number }>;
}

async function probe(port: number, url: string): Promise<ProbeResult> {
  const target = (await fetchJson(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`,
    "PUT",
  )) as { webSocketDebuggerUrl: string; id: string };

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map<number, (value: unknown) => void>();
  const loaded = new Promise<void>((resolve) => {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        method?: string;
        result?: unknown;
      };
      if (message.id !== undefined) pending.get(message.id)?.(message.result);
      if (message.method === "Page.loadEventFired") resolve();
    });
  });

  const send = (method: string, params: unknown = {}): Promise<unknown> => {
    const id = ++nextId;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
  };

  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    ...VIEWPORT,
    deviceScaleFactor: 3,
    mobile: true,
  });
  await send("Page.navigate", { url });
  await Promise.race([loaded, sleep(20000)]);
  // Let fonts settle before measuring.
  await sleep(600);

  const evaluated = (await send("Runtime.evaluate", {
    expression: PROBE,
    returnByValue: true,
  })) as { result?: { value?: string } };

  socket.close();
  // /json/close answers in plain text, not JSON, and we do not care what it says.
  await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(
    () => undefined,
  );

  return JSON.parse(evaluated.result?.value ?? "{}") as ProbeResult;
}

async function waitForDevTools(port: number): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await fetchJson(`http://127.0.0.1:${port}/json/version`);
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error("Chrome never opened its debugging port.");
}

async function fetchJson(url: string, method = "GET"): Promise<unknown> {
  const response = await fetch(url, { method });
  if (!response.ok) throw new Error(`${method} ${url} -> ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function join(a: string, b: string): string {
  return `${a.replace(/[\\/]$/, "")}/${b}`;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
