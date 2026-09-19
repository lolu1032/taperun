import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, statSync } from "node:fs";
import { run } from "../scripts/run.mjs";

const pages = {
  "/": `<a href="/login">Login</a><img src="/missing.png">`,
  "/login": `<form><input id="email"><button>Sign in</button></form><h1>로그인</h1>`,
};
const server = createServer((req, res) => {
  res.writeHead(pages[req.url] ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
  res.end(pages[req.url] ?? "nope");
});
await new Promise((r) => server.listen(0, r));
const baseURL = `http://127.0.0.1:${server.address().port}`;
const out = new URL("../.test-out/", import.meta.url).pathname;

test("pass: goto → click → fill → expect", async () => {
  const r = await run({ name: "pass", baseURL, steps: [
    { goto: "/" }, { click: "text=Login" }, { fill: ["#email", "a@b.c"] },
    { expect: { url: "/login", text: "로그인", visible: "button" } },
  ]}, { out });
  assert.equal(r.ok, true);
  assert.equal(r.steps.length, 4);
  assert.ok(existsSync(r.video) && statSync(r.video).size > 0, "video.webm exists");
});

test("fail: wrong expect stops at that step, screenshot taken, rest skipped", async () => {
  const r = await run({ name: "fail", baseURL, steps: [
    { goto: "/" }, { expect: { text: "없는글자" } }, { goto: "/login" },
  ]}, { out });
  assert.equal(r.ok, false);
  assert.equal(r.steps.length, 2);
  assert.equal(r.steps[1].ok, false);
  assert.ok(existsSync(r.steps[1].screenshot));
  assert.equal(r.skipped, 1);
  assert.ok(r.console.some((c) => c.type === "http" && c.text.startsWith("404")), "404 captured in console");
});

test.after(() => server.close());

test("virtual cursor follows mouse and survives navigation", async () => {
  const { chromium } = await import("playwright");
  const { CURSOR_SCRIPT } = await import("../scripts/run.mjs");
  const b = await chromium.launch({ channel: "chrome" });
  try {
    const p = await b.newPage();
    await p.addInitScript(CURSOR_SCRIPT);
    await p.goto(baseURL + "/");
    await p.mouse.move(123, 45);
    const pos = () => p.$eval("#__e2e_cursor", (el) => el.style.transform.replace(/\s/g, ""));
    assert.equal(await pos(), "translate(123px,45px)");
    await p.goto(baseURL + "/login");
    assert.equal(await pos(), "translate(123px,45px)", "position kept across navigation");
  } finally { await b.close(); }
});
