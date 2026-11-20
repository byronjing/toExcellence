import test from "node:test";
import assert from "node:assert/strict";
import { practiceSync, pendingRuns, localHome } from "../src/practiceSync.ts";
function setup() {
  const storage = Object.create({
    getItem(k) {
      return this[k] ?? null;
    },
    setItem(k, v) {
      this[k] = v;
    },
    removeItem(k) {
      delete this[k];
    },
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
  Object.defineProperty(globalThis, "window", {
    value: new EventTarget(),
    configurable: true,
  });
  return storage;
}
const run = () => ({
  id: "run",
  bank: "bank",
  mode: "wrong",
  items: [{ id: "q", stem: "题目", answer: ["A"] }],
  answers: {},
  mastery: { q: 3 },
  pos: 0,
  finished: false,
});
test("只暂存不上传，失败保留，刷新恢复，批量去重和账号隔离", async () => {
  setup();
  let calls = 0,
    fail = true,
    server = run();
  const request = async (op, p) => {
    calls++;
    if (fail) throw Error("断网");
    if (op === "sync")
      return { ...server, acknowledged: p.events.map((e) => e.eventId) };
    return server;
  };
  const q = practiceSync("alice", "run", request);
  q.remember(server);
  q.enqueue({ op: "answer", question: "q", answer: ["B"] });
  q.enqueue({ op: "rate", question: "q", mastery: 2 });
  assert.equal(calls, 0);
  assert.equal(q.project(server).mastery.q, 2);
  assert.deepEqual(pendingRuns("alice"), ["run"]);
  assert.deepEqual(pendingRuns("bob"), []);
  assert.equal((await q.load()).id, "run");
  await assert.rejects(q.flush(), /断网/);
  assert.equal(q.hasPending(), true);
  fail = false;
  await q.flush();
  assert.equal(q.hasPending(), false);
});
test("旧响应不覆盖新操作、仅确认的记录删除", async () => {
  setup();
  let release;
  const gate = new Promise((r) => (release = r));
  const q = practiceSync("alice", "run", async (op, p) => {
    await gate;
    return { ...run(), acknowledged: p.events.map((e) => e.eventId) };
  });
  q.remember(run());
  q.enqueue({ op: "answer", question: "q", answer: ["B"] });
  const flush = q.flush(() => {}, true);
  q.enqueue({ op: "rate", question: "q", mastery: 1 });
  release();
  await flush;
  assert.equal(q.hasPending(), true);
  assert.equal(q.project(run()).mastery.q, 1);
});
test("过期答案归档保留，不再重复上传；存储失败不会伪装成功", async () => {
  const storage = setup();
  const q = practiceSync("alice", "run", async (op, p) => ({
    ...run(),
    finished: true,
    rejected: p.events.map((e) => e.eventId),
    acknowledged: [],
  }));
  q.enqueue({ op: "answer", question: "q", answer: ["B"] });
  await q.flush();
  assert.equal(q.hasPending(), false);
  assert.equal(q.hasRejected(), true);
  storage.setItem = () => {
    throw Error("空间不足");
  };
  assert.throws(() => q.enqueue({ op: "move", pos: 1 }), /空间不足/);
});
test("看板叠加浏览器错题与掌握度", () => {
  setup();
  const q = practiceSync("alice", "run", async () => run());
  q.remember(run());
  q.enqueue({ op: "answer", question: "q", answer: ["B"] });
  assert.equal(
    localHome({ mistakes: [] }, "alice", async () => run()).mistakes[0].mastery,
    0,
  );
  q.enqueue({ op: "rate", question: "q", mastery: 3 });
  assert.equal(
    localHome({ mistakes: [] }, "alice", async () => run()).mistakes[0].mastery,
    3,
  );
});
