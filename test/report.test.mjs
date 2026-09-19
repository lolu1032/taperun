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
