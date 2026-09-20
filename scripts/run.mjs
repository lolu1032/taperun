#!/usr/bin/env node
// scenario.json → 크롬(전용 프로필)에서 실행 + 녹화 → result.json
// usage: node run.mjs scenario.json [--out DIR] [--headed]
import { chromium } from "playwright";
import { mkdir, mkdtemp, rm, writeFile, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { render, buildIndex } from "./report.mjs";

const PROFILE = join(homedir(), ".taperun", "chrome");
const STEP_TIMEOUT = 10_000;
const STEP_PAUSE = 300;   // 영상에서 단계 사이가 보이게
const END_PAUSE = 1000;   // 마지막 화면이 영상에 담기게 (즉시 close하면 끝 프레임이 잘림)

// 영상용 가상 커서. 헤드리스엔 OS 커서가 없으니 페이지 안에 div를 심고 mouse 이벤트를 따라가게 한다.
export const CURSOR_SCRIPT = `(() => {
  const pos = JSON.parse(sessionStorage.getItem("__e2e_cursor") || "[640,400]");
  const el = document.createElement("div"); el.id = "__e2e_cursor";
  el.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l14 9-6 1.5L8 19z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg><i></i>';
  Object.assign(el.style, { position: "fixed", left: 0, top: 0, zIndex: 2147483647, pointerEvents: "none", transition: "transform 60ms linear", transform: \`translate(\${pos[0]}px,\${pos[1]}px)\` });
  const style = document.createElement("style");
  style.textContent = "#__e2e_cursor i{position:absolute;left:-9px;top:-9px;width:40px;height:40px;border-radius:50%;background:rgba(37,99,235,.35);transform:scale(0);pointer-events:none}#__e2e_cursor.click i{animation:__e2e_ring .4s ease-out}@keyframes __e2e_ring{0%{transform:scale(.3);opacity:1}100%{transform:scale(1.4);opacity:0}}";
  const add = () => { document.documentElement.append(style, el); };
  document.body ? add() : document.addEventListener("DOMContentLoaded", add);
  document.addEventListener("mousemove", (e) => { el.style.transform = \`translate(\${e.clientX}px,\${e.clientY}px)\`; sessionStorage.setItem("__e2e_cursor", JSON.stringify([e.clientX, e.clientY])); }, true);
  document.addEventListener("mousedown", () => { el.classList.remove("click"); void el.offsetWidth; el.classList.add("click"); }, true);
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cur = { x: 640, y: 400 };
// 요소 중앙까지 커서를 부드럽게 이동 (영상에서 보이게). 요소 없으면 그냥 통과 → 뒤의 click/fill이 제대로 실패함
async function glide(page, selector) {
  const box = await page.locator(selector).first().boundingBox().catch(() => null);
  if (!box) return;
  const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const N = 20;
  for (let i = 1; i <= N; i++) { await page.mouse.move(cur.x + (to.x - cur.x) * i / N, cur.y + (to.y - cur.y) * i / N); await sleep(12); }
  cur = to;
}

export async function run(scenario, { out = ".taperun/out", headed = false } = {}) {
  const startedAt = new Date();
  const outDir = resolve(out, `${scenario.name}-${startedAt.toISOString().replace(/[:.]/g, "-")}`);
  await mkdir(outDir, { recursive: true });

  // 기본은 매번 새 프로필(재현 가능). 카카오/네이버처럼 로그인 세션이 필요한 흐름만 "profile": "shared"로 전용 프로필 사용
  const shared = scenario.profile === "shared";
  const profile = shared ? PROFILE : await mkdtemp(join(tmpdir(), "taperun-"));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: "chrome",
    headless: !headed,
    baseURL: scenario.baseURL,
    viewport: { width: 1280, height: 800 },
    args: ["--window-size=1280,800"],
    recordVideo: { dir: outDir, size: { width: 1280, height: 800 } },
  });
  ctx.setDefaultTimeout(STEP_TIMEOUT);
  await ctx.addInitScript(CURSOR_SCRIPT);
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  const console_ = [];
  page.on("console", (m) => m.type() === "error" && console_.push({ type: "console", text: m.text() }));
  page.on("pageerror", (e) => console_.push({ type: "pageerror", text: e.message }));
  page.on("requestfailed", (r) => console_.push({ type: "requestfailed", text: `${r.method()} ${r.url()} ${r.failure()?.errorText}` }));
  page.on("response", (r) => r.status() >= 400 && console_.push({ type: "http", text: `${r.status()} ${r.request().method()} ${r.url()}` }));

  const steps = [];
  let ok = true;
  for (const [i, step] of scenario.steps.entries()) {
    const t0 = Date.now();
    const rec = { i, step, ok: true, ms: 0 };
    try {
      await runStep(page, step);
    } catch (e) {
      rec.ok = ok = false;
      rec.error = String(e.message ?? e).split("\n")[0];
      rec.screenshot = join(outDir, `fail-step-${i}.png`);
      await page.screenshot({ path: rec.screenshot, fullPage: true }).catch(() => {});
    }
    rec.ms = Date.now() - t0;
    rec.url = page.url();
    steps.push(rec);
    if (!ok) break;
    await sleep(STEP_PAUSE);
  }
  await sleep(END_PAUSE);

  const rawVideo = await page.video()?.path();
  await ctx.close(); // 영상은 close 후에야 파일로 완성됨
  if (!shared) await rm(profile, { recursive: true, force: true });
  const videoPath = join(outDir, "video.webm");
  if (rawVideo) await rename(rawVideo, videoPath);

  const result = {
    name: scenario.name, ok, startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    video: videoPath, steps, skipped: scenario.steps.length - steps.length, console: console_,
  };
  await writeFile(join(outDir, "result.json"), JSON.stringify(result, null, 2));
  await writeFile(join(outDir, "report.html"), render(result));
  const { index } = await buildIndex(resolve(out));
  return { ...result, report: join(outDir, "report.html"), index };
}

// 단계 어휘: goto / click / fill / expect — emit-test.mjs와 공유
async function runStep(page, step) {
  if (step.goto != null) return page.goto(step.goto);
  if (step.click != null) { await glide(page, step.click); return page.click(step.click); }
  if (step.fill != null) { await glide(page, step.fill[0]); return page.fill(step.fill[0], step.fill[1]); }
  if (step.expect != null) {
    const { url, text, visible } = step.expect;
    if (url != null) {
      await page.waitForURL((u) => (url.startsWith("/") ? u.pathname === url : u.href.includes(url)));
    }
    if (text != null) await page.getByText(text).first().waitFor({ state: "visible" });
    if (visible != null) await page.locator(visible).first().waitFor({ state: "visible" });
    return;
  }
  throw new Error(`unknown step: ${JSON.stringify(step)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const [, , file, ...flags] = process.argv;
  if (!file) { console.error("usage: run.mjs scenario.json [--out DIR] [--headed]"); process.exit(2); }
  const { readFile } = await import("node:fs/promises");
  const scenario = JSON.parse(await readFile(file, "utf8"));
  const outIdx = flags.indexOf("--out");
  const r = await run(scenario, { out: outIdx >= 0 ? flags[outIdx + 1] : undefined, headed: flags.includes("--headed") });
  console.log(JSON.stringify({ ok: r.ok, report: r.report, index: r.index, video: r.video, failed: r.steps.find((s) => !s.ok) ?? null }, null, 2));
  process.exit(r.ok ? 0 : 1);
}
