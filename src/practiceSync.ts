import type { Run } from "./api";

type Change =
  | { op: "move"; pos: number }
  | { op: "answer"; question: string; answer: string[] };

type Request = (op: string, data: unknown) => Promise<Run>;
const active = new Map<string, Promise<void>>();

export function practiceSync(uid: string, id: string, request: Request) {
  const key = "toExcellence.pending." + uid + "." + id + ".";
  function keys() {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(key))
      .sort();
  }
  function read(k: string): Change | null {
    return JSON.parse(localStorage.getItem(k) || "null");
  }
  function project(run: Run): Run {
    if (run.finished) return run;
    const next = { ...run, answers: { ...run.answers } };
    for (const k of keys()) {
      const change = read(k);
      if (change?.op === "move") next.pos = change.pos;
      if (change?.op === "answer")
        next.answers[change.question] = change.answer;
    }
    return next;
  }
  async function load() {
    await active.get(key)?.catch(() => {});
    return request("get", { id });
  }
  function enqueue(change: Change) {
    const last = keys().at(-1);
    const sequence = last
      ? Number(last.slice(key.length, key.length + 16)) + 1
      : 0;
    const entry =
      key + String(sequence).padStart(16, "0") + "." + crypto.randomUUID();
    localStorage.setItem(entry, JSON.stringify(change));
  }
  function flush(accept: (run: Run) => void): Promise<void> {
    const existing = active.get(key);
    if (existing) return existing;
    if (!keys().length) return Promise.resolve();
    const write = async () => {
      let k;
      while ((k = keys()[0])) {
        const change = read(k);
        if (!change) continue;
        const { op, ...payload } = change;
        const run = await request(op, { id, ...payload });
        localStorage.removeItem(k);
        if (run.finished)
          keys().forEach((entry) => localStorage.removeItem(entry));
        accept(run);
      }
    };
    // Serialize writers across tabs as well as across practice-page remounts.
    const writer = navigator.locks
      ? navigator.locks.request(key, write)
      : write();
    const work = Promise.resolve(writer).finally(() => active.delete(key));
    active.set(key, work);
    return work;
  }
  return { load, project, enqueue, flush, hasPending: () => keys().length > 0 };
}
