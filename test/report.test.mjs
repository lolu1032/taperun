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
  assert.match(html, /href="browse-2026-09-20T16:00:00\.000Z\/report\.html"/);
  assert.ok(html.indexOf("browse-2026-09-20T16") < html.indexOf("browse-2026-09-20T15"), "최신이 위");
});

test("index says ALL PASS when nothing failed", () => {
  const html = renderIndex([run("a", true, "2026-09-20T10:00:00.000Z")]);
  assert.match(html, /ALL PASS/);
  assert.doesNotMatch(html, /class="why"/);
});
