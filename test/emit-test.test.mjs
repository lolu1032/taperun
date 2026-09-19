import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { emit } from "../scripts/emit-test.mjs";

const scenario = { name: "login \"quoted\"", baseURL: "http://localhost:3100", steps: [
  { goto: "/" },
  { click: "text=시작하기" },
  { fill: ["[placeholder='숫자 4자리']", "1234"] },
  { expect: { url: "/login", text: "닉네임", visible: "button[type=submit]" } },
  { expect: { url: "iana.org" } },
]};

test("every step maps to a playwright call, output is valid JS", () => {
  const src = emit(scenario);
  assert.match(src, /page\.goto\("\/"\)/);
  assert.match(src, /page\.click\("text=시작하기"\)/);
  assert.match(src, /page\.fill\("\[placeholder='숫자 4자리'\]", "1234"\)/);
  assert.match(src, /getByText\("닉네임"\)\.first\(\)\)\.toBeVisible/);
  assert.match(src, /locator\("button\[type=submit\]"\)\.first\(\)\)\.toBeVisible/);
  const f = join(mkdtempSync(join(tmpdir(), "taperun-")), "x.spec.mjs");
  writeFileSync(f, src);
  execFileSync(process.execPath, ["--check", f]); // throws on syntax error
});

test("url expect matches run.mjs semantics (pathname exact / substring)", () => {
  const res = [...emit(scenario).matchAll(/new RegExp\(("(?:[^"\\]|\\.)*")\)/g)].map((m) => new RegExp(JSON.parse(m[1])));
  const [path, sub] = res;
  assert.ok(path.test("http://localhost:3100/login"));
  assert.ok(path.test("http://localhost:3100/login?next=/"));
  assert.ok(!path.test("http://localhost:3100/login/extra"));
  assert.ok(!path.test("http://localhost:3100/"));
  assert.ok(sub.test("https://www.iana.org/help/example-domains"));
});

test("unknown step throws", () => {
  assert.throws(() => emit({ name: "x", baseURL: "", steps: [{ hover: "a" }] }), /unknown step/);
});
