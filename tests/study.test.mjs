import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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
  for (const f of [
    "20261114000100_study",
    "20261114000400_session_bank",
    "20261114000500_deferred_provision",
    "20261114000600_function_paths",
  ])
    await db.exec(readFileSync("supabase/migrations/" + f + ".sql", "utf8"));
  const migration = readdirSync("supabase/migrations").find((f) =>
    f.endsWith("_local_sync_mastery_export.sql"),
  );
  await db.exec(readFileSync("supabase/migrations/" + migration, "utf8"));
  const admin = "00000000-0000-4000-8000-000000000001",
    alice = "00000000-0000-4000-8000-000000000002",
    bob = "00000000-0000-4000-8000-000000000003";
  const rpc = async (uid, op, p = {}) =>
    (
      await db.query("select public.study_api($1,$2,$3) v", [
        uid,
        op,
        JSON.stringify({ ...p, clientVersion: 2 }),
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
  assert.deepEqual(s.items[0].answer, ["A"]);
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
  const w = await start("wrong");
  const batch = {
    id: w.id,
    events: [
      {
        op: "answer",
        question: "q1",
        answer: ["A"],
        eventId: "answer-1",
        occurredAt: "2026-11-21T00:00:00Z",
      },
      { op: "rate", question: "q1", mastery: 3, eventId: "rate-1" },
    ],
  };
  const first = await rpc(alice, "sync", batch);
  assert.deepEqual(first.acknowledged, ["answer-1", "rate-1"]);
  assert.deepEqual(
    (await rpc(alice, "sync", batch)).acknowledged,
    first.acknowledged,
  );
  assert.equal((await rpc(alice, "home")).mistakes[0].mastery, 3);
  await assert.rejects(rpc(bob, "sync", batch), /不存在/);
  await assert.rejects(
    rpc(alice, "rate", { id: w.id, question: "q1", mastery: 4 }),
    /评分/,
  );
  await rpc(alice, "finish", { id: w.id });
  await assert.rejects(start("wrong"), /暂无/);
  const exported = await rpc(alice, "export", { bank: b, questions: ["q1"] });
  assert.equal(exported.length, 1);
  assert.equal(exported[0].attempts.length, 5);
  assert.equal(
    exported[0].attempts.filter((a) => a.event_id === "answer-1").length,
    1,
  );
  assert.deepEqual(
    await rpc(bob, "export", { bank: b, questions: ["q1"] }),
    [],
  );
  await db.query("select study.record_result($1,$2,'q1',false,false)", [
    alice,
    b,
  ]);
  assert.equal((await rpc(alice, "home")).mistakes[0].mastery, 0);
  const continued = await rpc(alice, "get", { id: s.id });
  const moves = {
    id: s.id,
    events: [
      { op: "move", pos: 1, eventId: "move-1" },
      {
        op: "answer",
        question: continued.items[1].id,
        answer: continued.items[1].answer,
        eventId: "answer-2",
      },
      { op: "move", pos: 2, eventId: "move-2" },
    ],
  };
  assert.equal((await rpc(alice, "sync", moves)).pos, 2);
  assert.equal((await rpc(alice, "sync", moves)).pos, 2);
  const legacyView = (
    await db.query("select public.study_api($1,'get',$2) v", [
      alice,
      JSON.stringify({ id: s.id }),
    ])
  ).rows[0].v;
  assert.equal(
    legacyView.items[2].answer,
    undefined,
    "旧客户端保持提交前隐藏答案",
  );
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
  assert.equal(exam.items[0].answer, undefined);
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
  const late = await rpc(alice, "sync", {
    id: exam.id,
    events: [
      {
        op: "answer",
        question: exam.items[0].id,
        answer: ["A"],
        eventId: "late",
      },
    ],
  });
  assert.deepEqual(late.rejected, ["late"]);
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

test("升级迁移保留旧掌握状态且不伪造评分来源", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "create schema auth;create table auth.users(id uuid primary key,raw_app_meta_data jsonb);create role anon;create role authenticated;create role service_role bypassrls;",
  );
  await db.exec(
    readFileSync("supabase/migrations/20261114000100_study.sql", "utf8"),
  );
  const uid = "00000000-0000-4000-8000-000000000001";
  await db.query("insert into auth.users values($1,$2)", [
    uid,
    JSON.stringify({ username: "old", name: "旧用户", provisioned: true }),
  ]);
  await db.query(
    "insert into study.mistakes values($1,'bank','mastered',3),($1,'bank','new',1)",
    [uid],
  );
  const migration = readdirSync("supabase/migrations").find((f) =>
    f.endsWith("_local_sync_mastery_export.sql"),
  );
  await db.exec(readFileSync("supabase/migrations/" + migration, "utf8"));
  const rows = (
    await db.query(
      "select question,mastery,mastery_source from study.mistakes order by question",
    )
  ).rows;
  assert.deepEqual(rows, [
    { question: "mastered", mastery: 3, mastery_source: "legacy" },
    { question: "new", mastery: 0, mastery_source: "unrated" },
  ]);
});
