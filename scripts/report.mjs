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
.pill{font-weight:700;font-size:13px;padding:4px 12px;border-radius:999px;color:#fff;letter-spacing:.04em}.pill.ok{background:var(--ok)}.pill.fail{background:var(--fail)}.pill.run{background:var(--muted)}
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
.tag{font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;color:#fff;letter-spacing:.04em}.tag.ok{background:var(--ok)}.tag.fail{background:var(--fail)}.tag.run{background:var(--muted)}
.links{margin-left:auto;display:flex;gap:10px}.links a{color:var(--accent);text-decoration:none;font-size:13px}.links a:hover{text-decoration:underline}
.why{margin:8px 0 0;padding:8px 10px;border-radius:8px;background:var(--fail-bg);border:1px solid var(--fail);font:12.5px/1.5 var(--mono);word-break:break-all}
.hist{margin-top:8px}.hist summary{cursor:pointer;color:var(--muted);font-size:12px}.hist ol{list-style:none;margin:8px 0 0;padding:0}.hist li{display:flex;gap:10px;align-items:center;padding:4px 0;font-size:12px;color:var(--muted);border:0}
.wide{max-width:1400px}.card.flat{padding:0;overflow-x:auto}
.idx{width:100%;border-collapse:collapse;font-size:13px}.idx th{text-align:left;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;padding:10px 12px;border-bottom:1px solid var(--line);white-space:nowrap}
.idx td{padding:7px 12px;border-bottom:1px solid var(--line);vertical-align:middle;white-space:nowrap}.idx tr:last-child td{border-bottom:0}.idx tr.bad{background:var(--fail-bg)}
.idx .name a{color:var(--fg);font-weight:600;text-decoration:none}.idx .name small{display:block;color:var(--muted);font-size:12px;white-space:normal;max-width:360px}.idx .name a:hover{color:var(--accent)}.idx a{color:var(--accent);text-decoration:none}
.idx .num,.idx th.num{text-align:right;color:var(--muted);font-variant-numeric:tabular-nums}
.idx .reason{white-space:normal;min-width:260px;font:12px/1.45 var(--mono);color:var(--fail)}.idx .reason span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-all}
.idx .reason em{display:block;font:12px/1.45 -apple-system,"Pretendard",system-ui,sans-serif;font-style:normal;color:var(--fg);margin-top:2px}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:3px;background:var(--ok)}.dot.fail{background:var(--fail)}.dot.run{background:var(--muted)}
#player{padding:0;border:1px solid var(--line);border-radius:14px;background:var(--card);color:var(--fg);width:min(1200px,94vw);max-height:94vh}#player::backdrop{background:rgba(0,0,0,.75)}
#player .ph{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;font-size:14px}#player .ph button{background:none;border:0;color:var(--muted);font-size:18px;cursor:pointer;width:32px;height:32px}#player .ph button:hover{color:var(--fg)}
#player video{display:block;width:100%;max-height:calc(94vh - 52px);background:#000;border-radius:0}
.side{display:flex;flex-direction:column;gap:20px;min-width:0}
.issue .it{margin:0 0 10px;font-weight:600;font-size:15px}.issue .it a{color:var(--accent);text-decoration:none}
.issue dl{margin:0;display:grid;grid-template-columns:72px 1fr;gap:8px 12px;font-size:13px}.issue dt{color:var(--muted)}.issue dd{margin:0;white-space:pre-wrap}
`;

// 시나리오의 issue: { id, url, title, check, criteria, note } — 전부 선택. 이 실행이 무엇을 확인하려던 건지 사람이 읽는 칸
const issueCard = (i) => {
  if (!i) return "";
  const row = (k, v) => (v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : "");
  const head = i.id ? (i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.id)}</a>` : esc(i.id)) : "";
  return `<div class="card issue"><h2>이슈</h2>${head || i.title ? `<p class="it">${head} ${esc(i.title ?? "")}</p>` : ""}<dl>${row("시나리오", i.check)}${row("판단 기준", i.criteria)}${row("메모", i.note)}</dl></div>`;
};

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
<header><h1>${esc(r.name)}</h1>${r.title ? `<span style="color:var(--muted)">${esc(r.title)}</span>` : ""}<span class="pill ${r.ok ? "ok" : "fail"}">${r.ok ? "PASS" : "FAIL"}</span></header>
<p class="meta"><span>${esc(r.startedAt.replace("T", " ").slice(0, 19))}</span><span>${fmtMs(r.durationMs)}</span><span>${passed}/${total} 단계${r.skipped ? ` · ${r.skipped} 건너뜀` : ""}</span></p>
<div class="grid">
<div class="card"><h2>영상</h2><video controls preload="metadata" src="${esc(basename(r.video))}"></video></div>
<div class="side"><div class="card"><h2>요약</h2>
<div class="stat"><div><b style="color:var(--ok)">${passed}</b><small>통과</small></div><div><b style="color:var(--fail)">${failed ? 1 : 0}</b><small>실패</small></div><div><b style="color:var(--skip)">${r.skipped}</b><small>건너뜀</small></div></div>
<div class="bar"><i class="ok" style="width:${(passed / total) * 100}%"></i>${failed ? `<i class="fail" style="width:${100 / total}%"></i>` : ""}</div>
${failed ? `<p style="margin:14px 0 0"><b>${failed.i + 1}단계</b>에서 멈춤 — <span class="args">${esc(verb(failed.step))} ${esc(args(failed.step))}</span></p>` : `<p style="margin:14px 0 0">모든 단계 통과.</p>`}
</div>
${issueCard(r.issue)}</div>
</div>
<div class="card" style="margin-top:20px"><h2>단계</h2><ol class="steps">${[...r.steps, ...skippedSteps].map(li).join("")}</ol></div>
${failed ? `<div class="card failbox" style="margin-top:20px"><h2>실패: ${failed.i + 1}단계</h2><pre>${esc(failed.error)}</pre>${failed.diag ? `<ul style="margin:12px 0 0;padding-left:18px">${failed.diag.target ? `<li>${esc(failed.diag.target)}</li>` : ""}${(failed.diag.alerts ?? []).map((a) => `<li>화면 문구: «${esc(a)}»</li>`).join("")}</ul>` : ""}${failed.screenshot ? `<a class="shot" href="${esc(basename(failed.screenshot))}" target="_blank"><img src="${esc(basename(failed.screenshot))}" alt="실패 스크린샷"></a>` : ""}</div>` : ""}
${r.console.length ? `<div class="card" style="margin-top:20px"><details${failed ? " open" : ""}><summary>콘솔·네트워크 (${r.console.length})</summary><pre>${r.console.map((c) => esc(`[${c.type}] ${c.text}`)).join("\n")}</pre></details></div>` : ""}
</div></html>`;
}

const when = (iso) => iso.replace("T", " ").slice(0, 16);
const enc = (s) => encodeURIComponent(s);

// runs: [{ dir, r }], broken: [{ dir, name?, startedAt?, error, running? }]
// 둘을 한 목록으로 합쳐 시나리오별로 묶고, 각 시나리오의 최신 실행을 위에 둔다
export function renderIndex(runs, broken = []) {
  const items = [
    ...runs.map(({ dir, r }) => ({ dir, name: r.name, at: r.startedAt, r })),
    ...broken.map((b) => ({ dir: b.dir, name: b.name ?? b.dir, at: b.startedAt ?? "", error: b.error, running: b.running })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  const byName = new Map();
  for (const x of items) {
    if (!byName.has(x.name)) byName.set(x.name, []);
    byName.get(x.name).push(x);
  }
  const latest = [...byName.values()].map((v) => v[0]);
  const bad = latest.filter((x) => (x.error && !x.running) || (x.r && !x.r.ok)).length; // 실행 중은 실패로 안 센다
  const running = latest.filter((x) => x.running).length;
  const badge = bad ? { cls: "fail", text: `FAIL ${bad}` } : running ? { cls: "run", text: `RUNNING ${running}` } : { cls: "ok", text: "ALL PASS" };

  const tag = (x) => (x.running ? '<span class="tag run">RUN</span>' : x.error ? '<span class="tag fail">ERROR</span>' : `<span class="tag ${x.r.ok ? "ok" : "fail"}">${x.r.ok ? "PASS" : "FAIL"}</span>`);
  const isBad = (x) => (x.error && !x.running) || (x.r && !x.r.ok);
  // 한 줄 사유: 실패 단계 + 셀렉터 + 에러 첫 줄. 전문은 title(마우스오버)과 리포트에 있다
  const why = (x) => {
    if (x.error) return { short: x.error, full: x.error };
    const f = x.r?.steps.find((s) => !s.ok);
    if (!f) return null;
    const head = `${f.i + 1}단계 ${verb(f.step)} ${args(f.step)}`;
    const err = String(f.error ?? "").split("\n")[0].replace(/^\w+\.\w+: /, "");
    const d = f.diag ? [f.diag.target, ...(f.diag.alerts ?? []).map((a) => `화면: «${a}»`)].filter(Boolean).join(" · ") : "";
    return { short: `${head} — ${err}`, diag: d, full: `${head}\n${f.error ?? ""}${d ? `\n${d}` : ""}` };
  };
  const dot = (h) => `<a class="dot ${h.running ? "run" : isBad(h) ? "fail" : "ok"}" href="${esc(enc(h.dir))}/report.html" title="${h.at ? when(h.at) : "-"} ${h.running ? "RUN" : isBad(h) ? "FAIL" : "PASS"}"></a>`;
  const row = (v) => {
    const x = v[0], w = why(x);
    const total = x.r ? x.r.steps.length + x.r.skipped : 0;
    return `<tr class="${isBad(x) ? "bad" : ""}">
<td>${tag(x)}</td>
<td class="name">${x.r ? `<a href="${esc(enc(x.dir))}/report.html">${esc(x.name)}</a>` : esc(x.name)}${x.r?.title ? `<small>${esc(x.r.title)}</small>` : ""}</td>
<td class="num">${x.r ? `${x.r.steps.filter((s) => s.ok).length}/${total}` : "-"}</td>
<td class="num">${x.r ? fmtMs(x.r.durationMs) : "-"}</td>
<td class="num">${x.at ? when(x.at).slice(5) : "-"}</td>
<td class="reason">${w ? `<span title="${esc(w.full)}">${esc(w.short)}</span>${w.diag ? `<em>${esc(w.diag)}</em>` : ""}` : ""}</td>
<td class="hist">${v.slice(0, 8).reverse().map(dot).join("")}</td>
<td class="num">${x.r ? `<a class="vid" href="${esc(enc(x.dir))}/${esc(enc(basename(x.r.video)))}" data-title="${esc(x.name)}">영상</a>` : ""}</td>
</tr>`;
  };
  // 실패 먼저, 그 안에서는 이름순 — 번호 붙은 시나리오(b-2942 …)가 나란히 온다
  const groups = [...byName.values()].sort((a, b) => (isBad(b[0]) - isBad(a[0])) || a[0].name.localeCompare(b[0].name));
  const pass = latest.filter((x) => x.r?.ok).length;

  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>taperun — ${bad ? `실패 ${bad}` : running ? `실행 중 ${running}` : "전체 통과"}</title><style>${CSS}</style>
<div class="wrap wide">
<header><h1>taperun</h1><span class="pill ${badge.cls}">${badge.text}</span></header>
<p class="meta"><span>시나리오 ${latest.length}개 · <b style="color:var(--ok)">통과 ${pass}</b> · <b style="color:var(--fail)">실패 ${bad}</b>${running ? ` · 실행 중 ${running}` : ""}</span><span>실행 ${items.length}회</span><span>마지막 ${latest.length && latest[0].at ? when(latest[0].at) : "-"}</span></p>
<div class="card flat"><table class="idx">
<thead><tr><th></th><th>시나리오</th><th class="num">단계</th><th class="num">시간</th><th class="num">실행</th><th>실패 사유</th><th>이력</th><th></th></tr></thead>
<tbody>${groups.map(row).join("")}</tbody></table></div>
</div>
<dialog id="player"><div class="ph"><b></b><button type="button" aria-label="닫기">✕</button></div><video controls autoplay></video></dialog>
<script>
// 영상 링크는 페이지를 떠나지 않고 확대 창으로 연다. Esc·바깥 클릭·✕ 로 닫는다
const d = document.getElementById("player"), v = d.querySelector("video");
document.addEventListener("click", (e) => {
  const a = e.target.closest("a.vid"); if (!a || e.metaKey || e.ctrlKey) return;
  e.preventDefault(); d.querySelector("b").textContent = a.dataset.title; v.src = a.getAttribute("href"); d.showModal();
});
d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("button")) d.close(); });
d.addEventListener("close", () => { v.pause(); v.removeAttribute("src"); v.load(); });
</script></html>`;
}

// out 폴더를 훑어 각 실행의 report.html과 index.html을 쓴다
// ponytail: 마커가 이 시간보다 오래되면 죽은 실행으로 본다. 단계 타임아웃이 10초라 넉넉하다
const STALE_MS = 10 * 60 * 1000;

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
        const running = Date.now() - Date.parse(m.startedAt) < STALE_MS;
        broken.push({ dir, name: m.name, startedAt: m.startedAt, running, error: running ? "아직 실행 중" : "실행이 끝나지 않았다 (result.json 없음)" });
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
