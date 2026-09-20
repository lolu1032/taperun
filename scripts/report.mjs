#!/usr/bin/env node
// result.json → report.html, 또는 out 폴더 → index.html(시나리오별 최신 + 히스토리)
// usage: node report.mjs <result.json | out-dir>
import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const verb = (s) => Object.keys(s)[0];
const args = (s) => { const v = s[verb(s)]; return typeof v === "string" ? v : Array.isArray(v) ? v.join(" → ") : Object.entries(v).map(([k, x]) => `${k}: ${x}`).join(" · "); };
const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--fg:#1a1d21;--muted:#6b7280;--line:#e5e7eb;--mono:ui-monospace,SFMono-Regular,Menlo,monospace;--ok:#16a34a;--ok-bg:#ecfdf5;--fail:#dc2626;--fail-bg:#fef2f2;--skip:#9ca3af;--accent:#2563eb}
@media(prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a21;--fg:#e6e8eb;--muted:#8b93a1;--line:#262b35;--ok-bg:#0f2a1c;--fail-bg:#2a1214}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 -apple-system,"Pretendard",system-ui,sans-serif}
.wrap{max-width:1040px;margin:0 auto;padding:32px 20px 64px}
header{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:8px}h1{font-size:24px;margin:0;letter-spacing:-.01em}
.pill{font-weight:700;font-size:13px;padding:4px 12px;border-radius:999px;color:#fff;letter-spacing:.04em}.pill.ok{background:var(--ok)}.pill.fail{background:var(--fail)}
.meta{color:var(--muted);display:flex;gap:14px;flex-wrap:wrap;margin:0 0 24px}.meta span::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--line);margin-right:8px;vertical-align:middle}
.grid{display:grid;grid-template-columns:1fr;gap:20px}@media(min-width:820px){.grid{grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)}}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px}.card h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 12px}
video{width:100%;border-radius:10px;background:#000;display:block}
.steps{list-style:none;margin:0;padding:0}.steps li{display:grid;grid-template-columns:28px 1fr auto;gap:12px;padding:10px 0;border-top:1px solid var(--line);align-items:start}.steps li:first-child{border-top:0}
.n{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;color:#fff;background:var(--ok)}.fail .n{background:var(--fail)}.skip .n{background:var(--skip)}
.verb{display:inline-block;font:600 11px/1 var(--mono);padding:3px 7px;border-radius:5px;background:var(--bg);border:1px solid var(--line);margin-right:8px;text-transform:uppercase}
.args{font-family:var(--mono);font-size:13px;word-break:break-all}.url{display:block;color:var(--muted);font-size:12px;margin-top:3px;word-break:break-all}.ms{color:var(--muted);font-variant-numeric:tabular-nums;font-size:12px;padding-top:4px}
.skip .args,.skip .verb{opacity:.5}
.failbox{border-color:var(--fail);background:var(--fail-bg)}.failbox h2{color:var(--fail)}
pre{margin:0;font:12.5px/1.5 var(--mono);white-space:pre-wrap;word-break:break-all;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px}
.shot{display:block;margin-top:12px;border:1px solid var(--line);border-radius:10px;overflow:hidden;max-height:420px}.shot img{width:100%;display:block}
details summary{cursor:pointer;font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:12px}
.stat{display:flex;gap:18px;margin-bottom:14px}.stat b{display:block;font-size:22px;letter-spacing:-.02em}.stat small{color:var(--muted)}
.bar{height:6px;border-radius:999px;background:var(--line);overflow:hidden;display:flex}.bar i{display:block;height:100%}.bar .ok{background:var(--ok)}.bar .fail{background:var(--fail)}
.back{display:inline-block;color:var(--muted);text-decoration:none;margin-bottom:12px}.back:hover{color:var(--accent)}
.runs{list-style:none;margin:0;padding:0}.runs li{border-top:1px solid var(--line);padding:12px 0}.runs li:first-child{border-top:0}
.row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.row .name{font-weight:600;font-size:15px}.row .when,.row .nums{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
.tag{font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;color:#fff;letter-spacing:.04em}.tag.ok{background:var(--ok)}.tag.fail{background:var(--fail)}
.links{margin-left:auto;display:flex;gap:10px}.links a{color:var(--accent);text-decoration:none;font-size:13px}.links a:hover{text-decoration:underline}
.why{margin:8px 0 0;padding:8px 10px;border-radius:8px;background:var(--fail-bg);border:1px solid var(--fail);font:12.5px/1.5 var(--mono);word-break:break-all}
.hist{margin-top:8px}.hist summary{cursor:pointer;color:var(--muted);font-size:12px}.hist ol{list-style:none;margin:8px 0 0;padding:0}.hist li{display:flex;gap:10px;align-items:center;padding:4px 0;font-size:12px;color:var(--muted);border:0}
`;

export function render(r) {
  const total = r.steps.length + r.skipped;
  const passed = r.steps.filter((s) => s.ok).length;
  const failed = r.steps.find((s) => !s.ok);
  const skippedSteps = Array.from({ length: r.skipped }, (_, k) => ({ i: r.steps.length + k, skip: true }));
  const li = (s) => s.skip
    ? `<li class="skip"><span class="n">${s.i + 1}</span><div><span class="verb">skip</span><span class="args">실행 안 됨</span></div><span class="ms">—</span></li>`
    : `<li class="${s.ok ? "ok" : "fail"}"><span class="n">${s.ok ? "✓" : "✕"}</span><div><span class="verb">${esc(verb(s.step))}</span><span class="args">${esc(args(s.step))}</span>${s.url ? `<span class="url">${esc(s.url)}</span>` : ""}</div><span class="ms">${fmtMs(s.ms)}</span></li>`;

  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(r.name)} — ${r.ok ? "PASS" : "FAIL"}</title><style>${CSS}</style>
<div class="wrap">
<a class="back" href="../index.html">← 전체</a>
<header><h1>${esc(r.name)}</h1><span class="pill ${r.ok ? "ok" : "fail"}">${r.ok ? "PASS" : "FAIL"}</span></header>
<p class="meta"><span>${esc(r.startedAt.replace("T", " ").slice(0, 19))}</span><span>${fmtMs(r.durationMs)}</span><span>${passed}/${total} 단계${r.skipped ? ` · ${r.skipped} 건너뜀` : ""}</span></p>
<div class="grid">
<div class="card"><h2>영상</h2><video controls preload="metadata" src="${esc(basename(r.video))}"></video></div>
<div class="card"><h2>요약</h2>
<div class="stat"><div><b style="color:var(--ok)">${passed}</b><small>통과</small></div><div><b style="color:var(--fail)">${failed ? 1 : 0}</b><small>실패</small></div><div><b style="color:var(--skip)">${r.skipped}</b><small>건너뜀</small></div></div>
<div class="bar"><i class="ok" style="width:${(passed / total) * 100}%"></i>${failed ? `<i class="fail" style="width:${100 / total}%"></i>` : ""}</div>
${failed ? `<p style="margin:14px 0 0"><b>${failed.i + 1}단계</b>에서 멈춤 — <span class="args">${esc(verb(failed.step))} ${esc(args(failed.step))}</span></p>` : `<p style="margin:14px 0 0">모든 단계 통과.</p>`}
</div>
</div>
<div class="card" style="margin-top:20px"><h2>단계</h2><ol class="steps">${[...r.steps, ...skippedSteps].map(li).join("")}</ol></div>
${failed ? `<div class="card failbox" style="margin-top:20px"><h2>실패: ${failed.i + 1}단계</h2><pre>${esc(failed.error)}</pre>${failed.screenshot ? `<a class="shot" href="${esc(basename(failed.screenshot))}" target="_blank"><img src="${esc(basename(failed.screenshot))}" alt="실패 스크린샷"></a>` : ""}</div>` : ""}
${r.console.length ? `<div class="card" style="margin-top:20px"><details${failed ? " open" : ""}><summary>콘솔·네트워크 (${r.console.length})</summary><pre>${r.console.map((c) => esc(`[${c.type}] ${c.text}`)).join("\n")}</pre></details></div>` : ""}
</div></html>`;
}

const when = (iso) => iso.replace("T", " ").slice(0, 16);
const enc = (s) => encodeURIComponent(s);

// runs: [{ dir, r }] — 시나리오별로 묶어 최신 실행을 위에, 나머지는 접어서
export function renderIndex(runs, broken = []) {
  const byName = new Map();
  for (const x of [...runs].sort((a, b) => (a.r.startedAt < b.r.startedAt ? 1 : -1))) {
    if (!byName.has(x.r.name)) byName.set(x.r.name, []);
    byName.get(x.r.name).push(x);
  }
  const latest = [...byName.values()].map((v) => v[0]);
  const failed = latest.filter((x) => !x.r.ok);
  const li = ({ dir, r }, history) => {
    const f = r.steps.find((s) => !s.ok);
    const total = r.steps.length + r.skipped;
    return `<li>
<div class="row"><span class="tag ${r.ok ? "ok" : "fail"}">${r.ok ? "PASS" : "FAIL"}</span><span class="name">${esc(r.name)}</span>
<span class="when">${when(r.startedAt)}</span><span class="nums">${r.steps.filter((s) => s.ok).length}/${total} 단계 · ${fmtMs(r.durationMs)}</span>
<span class="links"><a href="${esc(enc(dir))}/report.html">리포트</a><a href="${esc(enc(dir))}/${esc(enc(basename(r.video)))}">영상</a></span></div>
${f ? `<p class="why">${f.i + 1}단계 ${esc(verb(f.step))} ${esc(args(f.step))} — ${esc(f.error)}</p>` : ""}
${history.length ? `<details class="hist"><summary>이전 실행 ${history.length}회</summary><ol>${history.map(({ dir, r }) => `<li><span class="tag ${r.ok ? "ok" : "fail"}">${r.ok ? "PASS" : "FAIL"}</span><span>${when(r.startedAt)}</span><span>${fmtMs(r.durationMs)}</span><span class="links"><a href="${esc(enc(dir))}/report.html">리포트</a></span></li>`).join("")}</ol></details>` : ""}
</li>`;
  };
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>taperun — ${failed.length || broken.length ? `실패 ${failed.length + broken.length}` : "전체 통과"}</title><style>${CSS}</style>
<div class="wrap">
<header><h1>taperun</h1><span class="pill ${failed.length || broken.length ? "fail" : "ok"}">${failed.length || broken.length ? `FAIL ${failed.length + broken.length}` : "ALL PASS"}</span></header>
<p class="meta"><span>시나리오 ${latest.length}개</span><span>실행 ${runs.length}회</span><span>마지막 ${latest.length ? when(latest[0].r.startedAt) : "-"}</span></p>
<div class="card"><ol class="runs">${[...byName.values()].map((v) => li(v[0], v.slice(1))).join("")}${broken.map(({ dir, error }) => `<li><div class="row"><span class="tag fail">ERROR</span><span class="name">${esc(dir)}</span><span class="when">읽지 못함</span></div><p class="why">${esc(error)}</p></li>`).join("")}</ol></div>
</div></html>`;
}

// out 폴더를 훑어 각 실행의 report.html과 index.html을 쓴다
export async function buildIndex(outDir) {
  const dirs = (await readdir(outDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  const runs = [], broken = [];
  for (const dir of dirs) {
    let raw;
    try {
      raw = await readFile(join(outDir, dir, "result.json"), "utf8");
    } catch (e) {
      if (e.code !== "ENOENT") { broken.push({ dir, error: String(e.message ?? e) }); continue; }
      // result.json이 없다: 실행 중에 죽은 폴더면 알리고, 그냥 남의 폴더면 건너뛴다
      try {
        const m = JSON.parse(await readFile(join(outDir, dir, "started.json"), "utf8"));
        broken.push({ dir, error: `실행이 끝나지 않았다 (${m.name}, ${m.startedAt} 시작, result.json 없음)` });
      } catch { /* 실행 폴더가 아니다 */ }
      continue;
    }
    try {
      const r = JSON.parse(raw);
      await writeFile(join(outDir, dir, "report.html"), render(r));
      runs.push({ dir, r });
    } catch (e) {
      broken.push({ dir, error: String(e.message ?? e) }); // 깨진 결과를 index에서 숨기지 않는다
    }
  }
  const index = join(outDir, "index.html");
  await writeFile(index, renderIndex(runs, broken));
  return { index, count: runs.length, broken: broken.length };
}

if (process.argv[1] && new URL(import.meta.url).pathname.endsWith(basename(process.argv[1]))) {
  const target = process.argv[2];
  if (!target) { console.error("usage: report.mjs <result.json | out-dir>"); process.exit(2); }
  if (target.endsWith(".json")) {
    const r = JSON.parse(await readFile(target, "utf8"));
    const out = join(dirname(target), "report.html");
    await writeFile(out, render(r));
    console.log(out);
  } else {
    const { index, count } = await buildIndex(target);
    console.log(`${index} (실행 ${count}회)`);
  }
}
