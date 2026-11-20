// Uses the real SQL migrations in PGlite and intercepts API transport; never writes to the hosted database.
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
const require = createRequire(process.cwd() + "/package.json");
const { PGlite } = require("@electric-sql/pglite");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const db = new PGlite();
await db.exec(
  "create schema auth; create table auth.users(id uuid primary key,raw_app_meta_data jsonb); create role anon;create role authenticated;create role service_role bypassrls;",
);
for (const f of readdirSync("supabase/migrations")
  .filter((f) => !f.includes("expiry") && !f.includes("credentials"))
  .sort())
  await db.exec(readFileSync("supabase/migrations/" + f, "utf8"));
const uid = "00000000-0000-4000-8000-000000000002";
await db.query("insert into auth.users values($1,$2)", [
  uid,
  JSON.stringify({
    username: "test",
    name: "测试用户",
    admin: true,
    provisioned: true,
  }),
]);
const rpc = async (op, p = {}) =>
  (
    await db.query("select public.study_api($1,$2,$3) v", [
      uid,
      op,
      JSON.stringify({ ...p, clientVersion: 2 }),
    ])
  ).rows[0].v;
const bank = JSON.parse(readFileSync("public/bank-template.json"));
await rpc("import", bank);
let initial = await rpc("start", {
  mode: "unit",
  bank: bank.id,
  unit: "intro",
});
await rpc("answer", { id: initial.id, question: "q1", answer: ["B"] });
const browser = await chromium.launch({ headless: true });
let failApi = false;
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [],
  calls = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/functions/v1/api", async (route) => {
  if (failApi)
    return route.fulfill({ status: 503, json: { error: "测试断网" } });
  const body = route.request().postDataJSON();
  calls.push(body.op);
  try {
    await route.fulfill({
      json: await rpc(body.op, body.p),
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (e) {
    await route.fulfill({ status: 400, json: { error: e.message } });
  }
});
await page.addInitScript(
  ({ uid }) => {
    const payload = btoa(
      JSON.stringify({
        sub: uid,
        exp: Math.floor(Date.now() / 1000) + 3600,
        role: "authenticated",
      }),
    );
    localStorage.setItem(
      "sb-omuyuybdustwqnecesny-auth-token",
      JSON.stringify({
        access_token: "eyJhbGciOiJIUzI1NiJ9." + payload + ".test",
        refresh_token: "test",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: uid,
          aud: "authenticated",
          role: "authenticated",
          email: "test@example.invalid",
        },
      }),
    );
  },
  { uid },
);
try {
  await page.goto(
    (process.env.TEST_BASE_URL || "http://127.0.0.1:5173/") + "#/wrong",
  );
  await page.getByRole("heading", { name: "我的错题" }).waitFor();
  await page.getByRole("button", { name: "开始或继续练习" }).click();
  await page.getByRole("button", { name: "提交答案" }).waitFor();
  const before = calls.filter((x) => x === "sync").length;
  await page.locator(".options button").first().click();
  await page.getByRole("button", { name: "提交答案" }).click();
  await page.getByText("回答正确", { exact: false }).waitFor();
  await page.getByRole("button", { name: "3星，已掌握", exact: true }).click();
  assert.equal(
    calls.filter((x) => x === "sync").length,
    before,
    "no per-answer/rating sync",
  );
  failApi = true;
  await page.reload();
  await page
    .getByRole("button", { name: "3星，已掌握", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "3星，已掌握", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.waitForTimeout(500);
  await page.screenshot({
    path: "/tmp/toex-practice-desktop.png",
    fullPage: true,
  });
  failApi = false;
  await page.getByRole("button", { name: "错题重练", exact: true }).click();
  await page.getByRole("heading", { name: "我的错题" }).waitFor();
  await page.waitForFunction(
    () =>
      !Object.keys(localStorage).some((k) =>
        k.startsWith("toExcellence.pending."),
      ),
  );
  assert.equal((await rpc("home")).mistakes[0].mastery, 3);
  await page.getByRole("button", { name: "全选筛选结果" }).click();
  const downloadP = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出 JSON/ }).click();
  const download = await downloadP;
  const path = await download.path();
  const data = JSON.parse(readFileSync(path));
  assert.equal(data.questions.length, 1);
  assert.equal(data.questions[0].mastery, 3);
  assert.equal(data.questions[0].attempts.length, 2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({
    path: "/tmp/toex-mistakes-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "no horizontal overflow",
  );
  await rpc("plan", {
    name: "计时测试",
    bank: bank.id,
    units: ["intro"],
    counts: { single: 1, multi: 0, judge: 0 },
    minutes: 1,
  });
  await page.clock.install();
  await page.goto(
    (process.env.TEST_BASE_URL || "http://127.0.0.1:5173/") + "#/exam",
  );
  await page.getByRole("button", { name: "开始或继续练习" }).click();
  await page.locator(".options button").first().waitFor();
  const syncBeforeExam = calls.filter((x) => x === "sync").length;
  await page.locator(".options button").first().click();
  assert.equal(calls.filter((x) => x === "sync").length, syncBeforeExam);
  await page.clock.fastForward(30000);
  await page.waitForFunction(
    () =>
      !Object.keys(localStorage).some((k) =>
        k.startsWith("toExcellence.pending."),
      ),
  );
  assert.ok(
    calls.filter((x) => x === "sync").length > syncBeforeExam,
    "exam periodically batches",
  );
  const examId = page.url().split("/run/")[1];
  assert.equal(
    Object.keys((await rpc("get", { id: examId })).answers).length,
    1,
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      result: "PASS",
      calls,
      exportQuestions: data.questions.length,
      attempts: data.questions[0].attempts.length,
      screenshots: [
        "/tmp/toex-practice-desktop.png",
        "/tmp/toex-mistakes-mobile.png",
      ],
    }),
  );
} finally {
  await browser.close();
  await db.close();
}
