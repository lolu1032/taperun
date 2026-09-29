#!/usr/bin/env node
// scenario.json → 크롬(전용 프로필)에서 실행 + 녹화 → result.json
// usage: node run.mjs scenario.json [--out DIR] [--headed]
import { chromium, webkit, firefox } from "playwright";
import { mkdir, mkdtemp, rm, writeFile, rename, readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir, tmpdir } from "node:os";
import { render, buildIndex } from "./report.mjs";

const PROFILE = join(homedir(), ".taperun", "chrome");
// 엔진. 기본은 설치된 크롬(따로 받지 않는다).
// webkit 은 **맥 Tauri 앱의 WKWebView 와 같은 계열**이라, 데스크톱 앱의 화면을 그
// 엔진으로 검증할 때 쓴다(vite dev 서버를 연다 — 네이티브 셸은 범위 밖).
// chromium 외에는 `channel` 을 주지 않는다 — 그 옵션은 크롬 계열 전용이다.
const ENGINES = { chromium, webkit, firefox };
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

// 폴더 이름 한 칸으로 쓸 수 있게. 한글은 그대로 두고 경로·URL을 깨는 문자만 바꾼다
export const safeName = (name) => (String(name).replace(/[/\\?#%:*"<>|\u0000-\u001f]+/g, "-").replace(/^[.\s]+|[.\s]+$/g, "") || "run");

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

// 엔진이 안 받아져 있으면 playwright 가 "Executable doesn't exist" 를 던진다.
// 그 메시지만으로는 뭘 해야 하는지 안 보여서 받는 명령으로 바꿔 준다.
async function launch(engine, name, profile, opts) {
  try {
    return await engine.launchPersistentContext(profile, opts);
  } catch (e) {
    if (/Executable doesn't exist|please run the following command/i.test(String(e.message ?? e))) {
      throw new Error(`${name} 엔진이 없다 — 스킬 폴더에서 \`npx playwright install ${name}\` 한 번 받는다`);
    }
    throw e;
  }
}

// 브라우저 한 번 띄워 여러 시나리오를 **한 페이지에서 차례로** 돌리는 세션.
// 시나리오마다 브라우저를 다시 띄우거나 새 탭을 열면(헤디드 크롬에서 새 탭 = 새 창) macOS 가
// 그때마다 크롬을 앞으로 가져와 포커스를 뺏는다. 페이지는 하나만 쓰고 영상은 screencast 로 시나리오마다 끊는다.
// 크롬(chromium)·임시 프로필만 공유한다. webkit/firefox·shared 프로필은 지금처럼 따로 띄운다.
export async function openSession({ headed = false } = {}) {
  const profile = await mkdtemp(join(tmpdir(), "taperun-"));
  const ctx = await launch(chromium, "chromium", profile, {
    channel: "chrome", headless: !headed,
    viewport: { width: 1280, height: 800 }, args: ["--window-size=1280,800"],
  });
  ctx.setDefaultTimeout(STEP_TIMEOUT);
  await ctx.addInitScript(CURSOR_SCRIPT);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("DOMStorage.enable").catch(() => {});
  return {
    ctx, page,
    // 시나리오 사이 격리: 빈 페이지로 빠진 뒤 쿠키 전부 + 방문한 origin 의 저장소를 지운다.
    // 같은 탭이라 sessionStorage 가 남으므로 그것도 지운다 (clearDataForOrigin 은 sessionStorage 를 안 건드린다)
    async reset(origins) {
      await page.goto("about:blank").catch(() => {});
      await ctx.clearCookies();
      for (const origin of origins) {
        await cdp.send("Storage.clearDataForOrigin", { origin, storageTypes: "all" }).catch(() => {});
        await cdp.send("DOMStorage.clear", { storageId: { securityOrigin: origin, isLocalStorage: false } }).catch(() => {});
      }
    },
    async close() {
      await ctx.close();
      await rm(profile, { recursive: true, force: true });
    },
  };
}

export async function run(scenario, { out = ".taperun/out", headed = false, baseDir = process.cwd(), session = null } = {}) {
  const startedAt = new Date();
  const outDir = resolve(out, `${safeName(scenario.name)}-${startedAt.toISOString().replace(/[:.]/g, "-")}`);
  await mkdir(outDir, { recursive: true });
  // 실행 중 표시. 중간에 죽으면 result.json이 없는 채 남고, 목록이 그걸 ERROR로 보여준다
  await writeFile(join(outDir, "started.json"), JSON.stringify({ name: scenario.name, startedAt: startedAt.toISOString() }));

  // 기본은 매번 새 프로필(재현 가능). 카카오/네이버처럼 로그인 세션이 필요한 흐름만 "profile": "shared"로 전용 프로필 사용
  const shared = scenario.profile === "shared";
  const name = scenario.engine ?? "chromium";
  const engine = ENGINES[name];
  if (!engine) throw new Error(`모르는 engine: ${name} (chromium | webkit | firefox)`);
  const useSession = session && name === "chromium" && !shared;
  const profile = useSession ? null : shared ? PROFILE : await mkdtemp(join(tmpdir(), "taperun-"));
  const ctx = useSession ? session.ctx : await launch(engine, name, profile, {
    ...(name === "chromium" ? { channel: "chrome" } : {}),
    headless: !headed,
    baseURL: scenario.baseURL,
    viewport: { width: 1280, height: 800 },
    ...(name === "chromium" ? { args: ["--window-size=1280,800"] } : {}),
    recordVideo: { dir: outDir, size: { width: 1280, height: 800 } },
  });
  if (!useSession) {
    ctx.setDefaultTimeout(STEP_TIMEOUT);
    await ctx.addInitScript(CURSOR_SCRIPT);
  }
  const page = useSession ? session.page : ctx.pages()[0] ?? (await ctx.newPage());
  const videoPath = join(outDir, "video.webm");
  if (useSession) await page.screencast.start({ path: videoPath, size: { width: 1280, height: 800 } });
  // 페이지가 뜨기 전에 넣을 것. Tauri 앱처럼 웹뷰가 심어 주는 전역이 없으면
  // 첫 줄에서 죽는 화면을 열 때 쓴다 (stubs/tauri.js). 경로는 시나리오 파일 기준.
  // 세션에서는 페이지를 같이 쓰니 끝나면 떼어 낸다
  const initScript = scenario.initScript ? await page.addInitScript(await readFile(resolve(baseDir, scenario.initScript), "utf8")) : null;
  const origins = new Set();
  const onNav = (f) => { try { const o = new URL(f.url()).origin; if (o.startsWith("http")) origins.add(o); } catch {} };
  page.on("framenavigated", onNav);

  const console_ = [];
  const listeners = {
    console: (m) => m.type() === "error" && console_.push({ type: "console", text: m.text() }),
    pageerror: (e) => console_.push({ type: "pageerror", text: e.message }),
    requestfailed: (r) => console_.push({ type: "requestfailed", text: `${r.method()} ${r.url()} ${r.failure()?.errorText}` }),
    response: (r) => r.status() >= 400 && console_.push({ type: "http", text: `${r.status()} ${r.request().method()} ${r.url()}` }),
  };
  for (const [ev, fn] of Object.entries(listeners)) page.on(ev, fn);

  const steps = [];
  let ok = true;
  for (const [i, step] of scenario.steps.entries()) {
    const t0 = Date.now();
    const rec = { i, step, ok: true, ms: 0 };
    try {
      // 세션 브라우저는 시나리오마다 baseURL 이 달라 컨텍스트에 못 건다 — 상대 경로는 여기서 붙인다
      let abs = useSession && step.goto != null && scenario.baseURL ? { ...step, goto: new URL(step.goto, scenario.baseURL).href } : step;
      if (abs.upload != null) abs = { ...abs, __baseDir: baseDir };
      await runStep(page, abs);
    } catch (e) {
      rec.ok = ok = false;
      rec.error = String(e.message ?? e).split("\n")[0];
      rec.screenshot = join(outDir, `fail-step-${i}.png`);
      await page.screenshot({ path: rec.screenshot, fullPage: true }).catch(() => {});
      rec.diag = await diagnose(page, step).catch(() => null);
    }
    rec.ms = Date.now() - t0;
    rec.url = page.url();
    steps.push(rec);
    if (!ok) break;
    await sleep(STEP_PAUSE);
  }
  await sleep(END_PAUSE);

  if (useSession) {
    await page.screencast.stop(); // 여기서 video.webm 이 완성된다
    for (const [ev, fn] of Object.entries(listeners)) page.off(ev, fn);
    page.off("framenavigated", onNav);
    await initScript?.dispose();
    await session.reset(origins);
  } else {
    const rawVideo = await page.video()?.path();
    await ctx.close(); // 영상은 close 후에야 파일로 완성됨
    if (!shared) await rm(profile, { recursive: true, force: true });
    if (rawVideo) await rename(rawVideo, videoPath);
  }

  const result = {
    name: scenario.name, title: scenario.title, issue: scenario.issue, ok, startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    video: videoPath, steps, skipped: scenario.steps.length - steps.length, console: console_,
  };
  await writeFile(join(outDir, "result.json"), JSON.stringify(result, null, 2));
  await writeFile(join(outDir, "report.html"), render(result));
  await rm(join(outDir, "started.json"), { force: true });
  const out2 = { ...result, report: join(outDir, "report.html") };
  try {
    out2.index = (await buildIndex(resolve(out))).index; // 목록 생성 실패가 실행 결과를 못 덮게
  } catch (e) {
    out2.indexError = String(e.message ?? e);
  }
  return out2;
}

// 실패 단계의 "왜" — 타임아웃 한 줄로는 안 보이는 것을 적는다.
// ① 대상 요소 상태(없음/숨김/비활성) ② 화면에 떠 있는 경고 문구(role=alert 또는 빨간 글씨).
// 예: 다음 버튼이 disabled + «만들 수 있는 워크스페이스를 모두 사용했어요 (3/3)»
async function diagnose(page, step) {
  const sel = step.click ?? step.fill?.[0] ?? step.select?.[0] ?? step.expect?.visible;
  let target = null;
  if (step.expect?.hidden) target = `없어야 할 요소가 화면에 보임 — ${step.expect.hidden}`;
  else if (sel) {
    const loc = page.locator(sel);
    const n = await loc.count();
    if (!n) target = "대상 요소가 화면에 없음";
    else {
      const el = loc.first();
      const vis = await el.isVisible(), en = await el.isEnabled().catch(() => true);
      target = !vis ? `대상 요소가 있지만 안 보임 (${n}개)` : !en ? "대상 요소가 비활성(disabled)" : `대상 요소는 보이고 활성 — 다른 요소가 가리고 있을 수 있음 (${n}개)`;
    }
  }
  // ponytail: "빨간 글씨" 휴리스틱(R>150, G·B<110). 디자인 토큰이 달라 못 잡으면 role=alert 만 남는다
  const alerts = await page.evaluate(() => {
    const out = new Set();
    const red = (c) => { const m = c.match(/\d+/g); return m && +m[0] > 150 && +m[1] < 110 && +m[2] < 110; };
    for (const el of document.querySelectorAll("body *")) {
      if (!el.checkVisibility?.() || el.closest("nextjs-portal,#__e2e_cursor")) continue;
      const own = [...el.childNodes].filter((x) => x.nodeType === 3).map((x) => x.textContent.trim()).join(" ").trim();
      if (!own || own.length > 200) continue;
      if (el.closest("[role=alert]") || red(getComputedStyle(el).color)) out.add(own);
      if (out.size >= 5) break;
    }
    return [...out];
  });
  return { target, alerts };
}

// 단계 어휘: goto / click / fill / expect — emit-test.mjs와 공유
// `"timeout": ms` 를 단계에 붙이면 그 단계만 더 기다린다. 기본 10초로는 못 재는 것
// (AI 생성·렌더처럼 분 단위로 끝나는 작업)이 있어서 열어 둔다. 남용하면 실패가 늦게
// 드러나니, 그 단계가 실제로 오래 걸릴 때만 붙인다.
async function runStep(page, step) {
  const timeout = step.timeout ?? STEP_TIMEOUT;
  if (step.goto != null) return page.goto(step.goto, { timeout });
  if (step.click != null) { await glide(page, step.click); return page.click(step.click, { timeout }); }
  if (step.fill != null) { await glide(page, step.fill[0]); return page.fill(step.fill[0], step.fill[1], { timeout }); }
  // <select> 는 fill 로 안 바뀌고, 헤드리스에서 option 클릭도 안 먹는다. 값(value)으로 고른다.
  if (step.select != null) { await glide(page, step.select[0]); return page.selectOption(step.select[0], step.select[1], { timeout }); }
  // 파일 올리기: [input[type=file] 셀렉터, 경로 | 경로 배열]. 경로는 시나리오 파일 기준.
  // 숨겨진 file input 에도 바로 넣는다 — OS 파일 선택 창을 띄우지 않는다.
  if (step.upload != null) {
    const [sel, files] = step.upload;
    const list = (Array.isArray(files) ? files : [files]).map((f) => resolve(step.__baseDir ?? ".", f));
    return page.setInputFiles(sel, list, { timeout });
  }
  if (step.expect != null) {
    const { url, text, visible, hidden } = step.expect;
    if (url != null) {
      await page.waitForURL((u) => (url.startsWith("/") ? u.pathname === url : u.href.includes(url)), { timeout });
    }
    if (text != null) await page.getByText(text).first().waitFor({ state: "visible", timeout });
    if (visible != null) await page.locator(visible).first().waitFor({ state: "visible", timeout });
    // 없어야 통과 — 셀렉터가 안 보이거나 DOM 에 없을 때까지 기다린다
    if (hidden != null) await page.locator(hidden).first().waitFor({ state: "hidden", timeout });
    return;
  }
  throw new Error(`unknown step: ${JSON.stringify(step)}`);
}

// 스킬 폴더가 심링크라 argv[1] 과 import.meta.url 이 다른 경로로 보인다 — 실제 경로로 비교
const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(new URL(import.meta.url).pathname); } catch { return false; } })();
if (isMain) {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf("--out");
  const out = outIdx >= 0 ? argv[outIdx + 1] : undefined;
  const headed = argv.includes("--headed");
  const files = argv.filter((a, k) => !a.startsWith("--") && !(outIdx >= 0 && k === outIdx + 1));
  if (!files.length) { console.error("usage: run.mjs a.json [b.json ...] [--out DIR] [--headed]"); process.exit(2); }
  // 여러 개면 브라우저 한 번만 띄워 탭으로 돌린다
  const session = files.length > 1 ? await openSession({ headed }) : null;
  let allOk = true;
  try {
    for (const file of files) {
      const scenario = JSON.parse(await readFile(file, "utf8"));
      const r = await run(scenario, { out, headed, session, baseDir: dirname(resolve(file)) }); // initScript 는 시나리오 옆에 둔다
      allOk &&= r.ok;
      const failed = r.steps.find((s) => !s.ok) ?? null;
      console.log(JSON.stringify({ name: scenario.name, ok: r.ok, report: r.report, index: r.index ?? null, indexError: r.indexError ?? null, video: r.video, failed }, null, files.length > 1 ? 0 : 2));
    }
  } finally {
    await session?.close();
  }
  process.exit(allOk ? 0 : 1);
}
