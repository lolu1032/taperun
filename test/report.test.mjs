import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "../scripts/report.mjs";

const base = { name: "demo", startedAt: "2026-09-19T00:00:00.000Z", durationMs: 1500, video: "/x/demo/video.webm", skipped: 0, console: [] };

test("pass report", () => {
  const html = render({ ...base, ok: true, steps: [{ i: 0, step: { goto: "/" }, ok: true, ms: 40, url: "http://a/" }] });
  assert.match(html, /PASS/);
  assert.match(html, /src="video\.webm"/, "video path is relative");
  assert.doesNotMatch(html, /실패:/);
});

test("fail report shows failed step, screenshot, escaped error, skipped count", () => {
  const html = render({ ...base, ok: false, skipped: 2, console: [{ type: "http", text: "404 GET http://a/x" }], steps: [
    { i: 0, step: { goto: "/" }, ok: true, ms: 40 },
    { i: 1, step: { expect: { text: "<b>" } }, ok: false, ms: 10000, error: "Timeout <10000ms>", screenshot: "/x/demo/fail-step-1.png" },
  ]});
  assert.match(html, /FAIL/);
  assert.match(html, /실패: 2단계/);
  assert.match(html, /src="fail-step-1\.png"/);
  assert.match(html, /Timeout &lt;10000ms&gt;/, "error is html-escaped");
  assert.match(html, /2 건너뜀/);
  assert.match(html, /\[http\] 404/);
});

import { renderIndex } from "../scripts/report.mjs";

const run = (name, ok, t, extra = {}) => ({ dir: `${name}-${t}`, r: { ...base, name, ok, startedAt: t, steps: [{ i: 0, step: { goto: "/" }, ok: true, ms: 10 }], ...extra } });

test("index groups by scenario, newest first, older runs collapsed", () => {
  const html = renderIndex([
    run("browse", true, "2026-09-20T15:00:00.000Z"),
    run("browse", false, "2026-09-20T16:00:00.000Z", { steps: [{ i: 0, step: { goto: "/" }, ok: true, ms: 10 }, { i: 1, step: { click: "text=더보기" }, ok: false, ms: 10000, error: "Timeout 10000ms exceeded." }], skipped: 1 }),
    run("see-all", true, "2026-09-20T15:30:00.000Z"),
  ]);
  assert.match(html, /시나리오 2개/);
  assert.match(html, /실행 3회/);
  assert.match(html, /FAIL 1/, "실패한 시나리오 수가 제목 배지에");
  assert.match(html, /2단계 click text=더보기 — Timeout/, "실패 이유가 목록에 바로 보인다");
  assert.match(html, /이전 실행 1회/, "같은 시나리오 과거 실행은 접힌다");
  assert.match(html, new RegExp(`href="${encodeURIComponent("browse-2026-09-20T16:00:00.000Z")}/report\\.html"`), "링크는 인코딩된다");
  assert.ok(html.indexOf("browse-2026-09-20T16") < html.indexOf("browse-2026-09-20T15"), "최신이 위");
});

test("index says ALL PASS when nothing failed", () => {
  const html = renderIndex([run("a", true, "2026-09-20T10:00:00.000Z")]);
  assert.match(html, /ALL PASS/);
  assert.doesNotMatch(html, /class="why"/);
});

import { buildIndex } from "../scripts/report.mjs";
import { safeName } from "../scripts/run.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join as pjoin } from "node:path";
import { tmpdir as td } from "node:os";

test("scenario name becomes one safe folder segment", () => {
  assert.equal(safeName("auth/login"), "auth-login");
  assert.equal(safeName("a#b?c"), "a-b-c");
  assert.equal(safeName("로그인 흐름"), "로그인 흐름", "한글·공백은 유지");
  assert.equal(safeName(".."), "run");
});

test("index shows unreadable runs instead of silently dropping them", async () => {
  const out = mkdtempSync(pjoin(td(), "taperun-idx-"));
  mkdirSync(pjoin(out, "ok-1")); writeFileSync(pjoin(out, "ok-1", "result.json"), JSON.stringify({ ...base, name: "ok", ok: true, steps: [{ i: 0, step: { goto: "/" }, ok: true, ms: 5 }] }));
  mkdirSync(pjoin(out, "broken-1")); writeFileSync(pjoin(out, "broken-1", "result.json"), "{ not json");
  mkdirSync(pjoin(out, "not-a-run"));
  const res = await buildIndex(out);
  assert.equal(res.count, 1);
  assert.equal(res.broken, 1);
  const html = readFileSync(res.index, "utf8");
  assert.match(html, /ERROR/);
  assert.match(html, /broken-1/);
  assert.doesNotMatch(html, /ALL PASS/, "읽지 못한 실행이 있으면 전체 통과라고 하지 않는다");
  assert.doesNotMatch(html, /not-a-run/, "실행 폴더가 아닌 건 조용히 건너뛴다");
});

test("index links are url-encoded", () => {
  const html = renderIndex([{ dir: "로그인 흐름-2026", r: { ...base, name: "로그인 흐름", ok: true, steps: [{ i: 0, step: { goto: "/" }, ok: true, ms: 5 }], video: "/x/video.webm" } }]);
  assert.match(html, /href="%ED%86%B5|href="[^"]*%20/, "공백·한글이 인코딩된다");
  assert.doesNotMatch(html, /href="[^"]* [^"]*"/, "href에 날 공백이 없다");
});

test("a run killed before finishing shows as ERROR, unrelated folders stay skipped", async () => {
  const out = mkdtempSync(pjoin(td(), "taperun-kill-"));
  mkdirSync(pjoin(out, "browse-2026")); writeFileSync(pjoin(out, "browse-2026", "started.json"), JSON.stringify({ name: "browse", startedAt: "2026-09-01T01:00:00.000Z" }));
  mkdirSync(pjoin(out, "ok-1")); writeFileSync(pjoin(out, "ok-1", "result.json"), JSON.stringify({ ...base, name: "ok", ok: true, steps: [{ i: 0, step: { goto: "/" }, ok: true, ms: 5 }] }));
  mkdirSync(pjoin(out, "videos-backup"));
  const res = await buildIndex(out);
  const html = readFileSync(res.index, "utf8");
  assert.equal(res.broken, 1);
  assert.match(html, /실행이 끝나지 않았다/);
  assert.doesNotMatch(html, /ALL PASS/);
  assert.doesNotMatch(html, /videos-backup/);
});

test("a killed newest run makes the scenario ERROR, older pass goes to history", () => {
  const html = renderIndex(
    [{ dir: "browse-15", r: { ...base, name: "browse", ok: true, startedAt: "2026-09-21T15:00:00.000Z", steps: [{ i: 0, step: { goto: "/" }, ok: true, ms: 5 }] } }],
    [{ dir: "browse-16", name: "browse", startedAt: "2026-09-21T16:00:00.000Z", error: "실행이 끝나지 않았다 (result.json 없음)" }],
  );
  assert.match(html, /시나리오 1개/, "같은 시나리오로 묶인다");
  assert.doesNotMatch(html, /ALL PASS/);
  assert.match(html, /FAIL 1/);
  assert.match(html, /이전 실행 1회/, "예전 PASS는 히스토리로 내려간다");
  assert.ok(html.indexOf("ERROR") < html.indexOf("이전 실행"), "ERROR가 최신 줄");
});

test("a run still in progress shows RUNNING and is not counted as failure", async () => {
  const out = mkdtempSync(pjoin(td(), "taperun-live-"));
  mkdirSync(pjoin(out, "browse-old")); writeFileSync(pjoin(out, "browse-old", "result.json"), JSON.stringify({ ...base, name: "browse", ok: true, startedAt: "2026-09-20T10:00:00.000Z", steps: [{ i: 0, step: { goto: "/" }, ok: true, ms: 5 }] }));
  mkdirSync(pjoin(out, "browse-now")); writeFileSync(pjoin(out, "browse-now", "started.json"), JSON.stringify({ name: "browse", startedAt: new Date().toISOString() }));
  const html = readFileSync((await buildIndex(out)).index, "utf8");
  assert.match(html, /RUNNING 1/, "헤더도 실행 중으로 표시");
  assert.doesNotMatch(html, /ALL PASS|전체 통과/, "아직 안 끝났으면 전체 통과라고 하지 않는다");
  assert.doesNotMatch(html, /FAIL/, "실행 중은 실패로 세지 않는다");
  assert.doesNotMatch(html, /실행이 끝나지 않았다/);
});
