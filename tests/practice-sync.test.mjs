import test from "node:test";
import assert from "node:assert/strict";
import { practiceSync } from "../src/practiceSync.ts";

test("慢网下可继续答题，旧响应保留本地进度，失败操作可恢复", async () => {
  const storage = Object.create({
    getItem(key) {
      return this[key] ?? null;
    },
    setItem(key, value) {
      this[key] = value;
    },
    removeItem(key) {
      delete this[key];
    },
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
  let release;
  const delay = new Promise((resolve) => {
    release = resolve;
  });
  let failMove = true;
  let server = { id: "run", pos: 0, answers: {}, finished: false };
  const calls = [];
  const request = async (op, p) => {
    calls.push(op);
    if (op === "move") {
      if (failMove) throw new Error("断网");
      server = { ...server, pos: p.pos };
    }
    if (op === "answer") {
      await delay;
      assert.equal(p.question, ["first", "second"][server.pos]);
      server = {
        ...server,
        answers: { ...server.answers, [p.question]: p.answer },
      };
    }
    return server;
  };
  const queue = practiceSync("alice", "run", request);
  queue.enqueue({ op: "answer", question: "first", answer: ["B"] });
  const updates = [];
  const saving = queue.flush((r) => updates.push(queue.project(r)));
  queue.enqueue({ op: "move", pos: 1 });
  queue.enqueue({ op: "answer", question: "second", answer: ["A"] });
  assert.equal(
    queue.flush(() => {}),
    saving,
  );
  const expected = {
    ...server,
    pos: 1,
    answers: { first: ["B"], second: ["A"] },
  };
  assert.deepEqual(queue.project(server), expected);
  release();
  await assert.rejects(saving, /断网/);
  assert.deepEqual(updates, [expected]);
  assert.equal(practiceSync("bob", "run", request).hasPending(), false);
  const resumed = practiceSync("alice", "run", request);
  assert.deepEqual(resumed.project(await resumed.load()), expected);
  failMove = false;
  await resumed.flush(() => {});
  assert.deepEqual(server, expected);
  assert.deepEqual(calls, ["answer", "move", "get", "move", "answer"]);
  assert.equal(resumed.hasPending(), false);
});
