import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, statSync } from "node:fs";
import { run, openSession } from "../scripts/run.mjs";

const pages = {
  "/": `<a href="/login">Login</a><img src="/missing.png">`,
  "/login": `<form><input id="email"><button>Sign in</button></form><h1>로그인</h1>`,
  // 세션 격리 확인용: /set 이 쿠키·localStorage 를 남기고 /check 가 그걸 보여 준다
  "/set": `<script>localStorage.setItem("ls","1");sessionStorage.setItem("ss","1")</script><p>set</p>`,
  "/check": `<p id="c"></p><script>document.getElementById("c").textContent = "cookie=" + document.cookie + "|ls=" + localStorage.getItem("ls") + "|ss=" + sessionStorage.getItem("ss")</script>`,
};
const server = createServer((req, res) => {
  res.writeHead(pages[req.url] ? 200 : 404, { "content-type": "text/html; charset=utf-8", ...(req.url === "/set" ? { "set-cookie": "seen=1; Path=/" } : {}) });
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

test("index failure does not hide the run result", async () => {
  const { mkdirSync } = await import("node:fs");
  const out = new URL("../.test-out/idx-fail/", import.meta.url).pathname;
  mkdirSync(out + "index.html", { recursive: true }); // index.html 자리를 폴더로 막아 쓰기를 실패시킨다
  const r = await run({ name: "idxfail", baseURL, steps: [{ goto: "/" }] }, { out });
  assert.equal(r.ok, true, "실행 결과는 그대로 나온다");
  assert.ok(r.report, "개별 리포트는 만들어진다");
  assert.ok(r.indexError, "목록 실패는 따로 알린다");
});

test("session: one browser, one page reused (no new tab/window), cookies/storage do not leak, each gets its own video", async () => {
  const session = await openSession({ out });
  try {
    const a = await run({ name: "sess-a", baseURL, steps: [
      { goto: "/set" }, { goto: "/check" }, { expect: { text: "cookie=seen=1|ls=1|ss=1" } },
    ]}, { out, session });
    const b = await run({ name: "sess-b", baseURL, steps: [
      { goto: "/check" }, { expect: { text: "cookie=|ls=null|ss=null" } },
    ]}, { out, session });
    assert.equal(a.ok, true, "첫 시나리오 안에서는 상태가 유지된다");
    assert.equal(b.ok, true, "다음 시나리오는 깨끗한 상태로 시작한다");
    assert.equal(session.ctx.pages().length, 1, "새 탭·창을 열지 않는다 — 열면 헤디드에서 포커스를 뺏는다");
    for (const r of [a, b]) assert.ok(existsSync(r.video) && statSync(r.video).size > 0, `${r.name} video`);
    assert.notEqual(a.video, b.video);
  } finally {
    await session.close();
  }
});
