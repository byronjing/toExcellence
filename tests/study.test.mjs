import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { validateBank } from "../supabase/functions/api/bank.ts";
const example = JSON.parse(readFileSync("public/bank-template.json"));
test("导入格式校验精确定位错误字段", () => {
  assert.equal(validateBank(structuredClone(example)).units.length, 1);
  const invalid = structuredClone(example);
  invalid.units[0].questions[0].answer = ["Z"];
  assert.throws(() => validateBank(invalid), /questions\[0\].answer/);
});
test("角色隔离、审批、练习、考试截止及历史快照", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "create schema auth; create table auth.users(id uuid primary key,raw_app_meta_data jsonb); create role anon;create role authenticated;create role service_role bypassrls;",
  );
  for (const f of ["20261114000100_study", "20261114000400_session_bank","20261114000500_deferred_provision","20261114000600_function_paths"])
    await db.exec(readFileSync("supabase/migrations/" + f + ".sql", "utf8"));
  const admin = "00000000-0000-4000-8000-000000000001",
    alice = "00000000-0000-4000-8000-000000000002",
    bob = "00000000-0000-4000-8000-000000000003";
  const rpc = async (uid, op, p = {}) =>
    (
      await db.query("select public.study_api($1,$2,$3) v", [
        uid,
        op,
        JSON.stringify(p),
      ])
    ).rows[0].v;
  await assert.rejects(
    db.query("insert into auth.users values($1,$2)", [alice, "{}"]),
    /管理员/,
  );
  for (const [id, name] of [
    [admin, "admin"],
    [alice, "alice"],
    [bob, "bob"],
  ])
    await db.query("insert into auth.users values($1,$2)", [
      id,
      JSON.stringify({
        name,
        username: name,
        admin: id === admin,
        provisioned: true,
      }),
    ]);
  await db.exec("set role service_role");
  await assert.rejects(rpc(null, "home"), /登录/);
  await assert.rejects(rpc(alice, "requests"), /权限/);
  await rpc(null, "apply", {
    username: "pending",
    name: "申请人",
    reason: "test",
    credential: "encrypted",
  });
  assert.equal((await rpc(admin, "requests"))[0].credential, undefined);
  await rpc(admin, "reject", { username: "pending" });
  assert.equal((await rpc(admin, "requests"))[0].state, "rejected");
  assert.equal((await rpc(admin, "preview", example)).added, 3);
  assert.equal((await rpc(alice, "home")).banks.length, 0);
  await rpc(admin, "import", example);
  const b = example.id,
    unit = "intro";
  const start = (mode, extra = {}) =>
    rpc(alice, "start", { bank: b, unit, mode, ...extra });
  const ans = (s, a) =>
    rpc(alice, "answer", { id: s.id, question: s.items[s.pos].id, answer: a });
  let s = await start("unit");
  assert.equal(s.items[0].answer, undefined);
  await assert.rejects(rpc(bob, "get", { id: s.id }), /不存在/);
  await ans(s, ["B"]);
  await ans(s, ["B"]);
  assert.deepEqual((await start("unit")).answers, { q1: ["B"] });
  for (let i = 1; i <= 3; i++) {
    let w = await start("wrong");
    await ans(w, ["A"]);
    await ans(w, ["A"]);
    await rpc(alice, "finish", { id: w.id });
    assert.equal((await rpc(alice, "home")).mistakes[0].streak, i);
  }
  const random = await start("random");
  assert.equal(new Set(random.items.map((q) => q.id)).size, 3);
  const p = {
    name: "测试方案",
    bank: b,
    units: [unit],
    counts: { single: 1, judge: 1, multi: 1 },
    minutes: 1,
  };
  await assert.rejects(
    rpc(admin, "plan", { ...p, counts: { multi: 2 } }),
    /缺少 1/,
  );
  await rpc(admin, "plan", p);
  const plan = (await rpc(alice, "home")).plans[0].id;
  const exam = await start("exam", { plan });
  await ans(exam, ["A"]);
  await ans(exam, ["B"]);
  assert.deepEqual(
    (await rpc(alice, "get", { id: exam.id })).answers[exam.items[0].id],
    ["B"],
  );
  const changed = structuredClone(example);
  changed.units[0].questions[0].stem = "新题干";
  await rpc(admin, "import", changed);
  await db.query(
    "update study.sessions set deadline=now()-interval '1 second' where id=$1",
    [exam.id],
  );
  await db.exec("select study.expire()");
  const done = await rpc(alice, "finish", { id: exam.id });
  assert.equal(done.finished, true);
  assert.ok(done.items.every((q) => q.answer));
  assert.ok(!done.items.some((q) => q.stem === "新题干"));
  const before = (await rpc(alice, "home")).mistakes;
  await rpc(alice, "finish", { id: exam.id });
  assert.deepEqual((await rpc(alice, "home")).mistakes, before);
  assert.deepEqual((await rpc(bob, "home")).mistakes, []);
  await db.exec("reset role;set role authenticated");
  await assert.rejects(rpc(admin, "requests"), /permission denied/);
  await assert.rejects(
    db.query("select * from study.questions"),
    /permission denied/,
  );
});
