import type { Run, Home, Mistake } from "./api.ts";

export type Change =
  | { op: "move"; pos: number }
  | { op: "answer"; question: string; answer: string[] }
  | { op: "rate"; question: string; mastery: number };
export type Entry = Change & { eventId: string; occurredAt: string | null };
type Result = Run & { acknowledged?: string[]; rejected?: string[] };
type Request = (
  op: string,
  data: unknown,
  keepalive?: boolean,
) => Promise<Result>;
const active = new Map<string, Promise<void>>();
const prefix = (uid: string) => "toExcellence.pending." + uid + ".";
const cacheKey = (uid: string, id: string) =>
  `toExcellence.run.v2.${uid}.${id}`;
export const changed = () => window.dispatchEvent(new Event("study-local"));
export function pendingRuns(uid: string) {
  return [
    ...new Set(
      Object.keys(localStorage)
        .filter((k) => k.startsWith(prefix(uid)))
        .map((k) => k.slice(prefix(uid).length).split(".")[0]),
    ),
  ];
}
export function practiceSync(uid: string, id: string, request: Request) {
  const key = prefix(uid) + id + ".";
  const keys = () =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith(key))
      .sort();
  function entries(): [string, Entry][] {
    return keys().map((k) => {
      const raw = JSON.parse(localStorage.getItem(k) || "null");
      if (!raw || !["move", "answer", "rate"].includes(raw.op))
        throw new Error("浏览器暂存记录损坏，请保留数据并联系管理员");
      return [
        k,
        {
          ...raw,
          eventId: raw.eventId || k,
          occurredAt: raw.occurredAt || null,
        },
      ];
    });
  }
  const cached = (): Run | null =>
    JSON.parse(localStorage.getItem(cacheKey(uid, id)) || "null");
  function remember(run: Run) {
    localStorage.setItem(
      cacheKey(uid, id),
      JSON.stringify({ ...run, receivedAt: Date.now() }),
    );
  }
  function project(run: Run): Run {
    const next = {
      ...run,
      answers: { ...run.answers },
      mastery: { ...run.mastery },
    };
    for (const [, c] of entries()) {
      if (c.op === "rate") next.mastery[c.question] = c.mastery;
      if (run.finished) continue;
      if (c.op === "move") next.pos = c.pos;
      if (c.op === "answer") {
        next.answers[c.question] = c.answer;
        const q = run.items.find((q) => q.id === c.question);
        if (q?.answer && JSON.stringify(q.answer) !== JSON.stringify(c.answer))
          next.mastery[c.question] = 0;
      }
    }
    return next;
  }
  async function load() {
    await active.get(key)?.catch(() => {});
    try {
      const run = await request("get", { id });
      remember(run);
      return run;
    } catch (e) {
      const run = cached();
      if (run) return run;
      throw e;
    }
  }
  function enqueue(change: Change) {
    const last = keys().at(-1);
    const sequence = last
      ? Number(last.slice(key.length, key.length + 16)) + 1
      : 0;
    const eventId = crypto.randomUUID();
    localStorage.setItem(
      key + String(sequence).padStart(16, "0") + "." + eventId,
      JSON.stringify({
        ...change,
        eventId,
        occurredAt: new Date().toISOString(),
      }),
    );
    changed();
  }
  function flush(
    accept: (run: Run) => void = () => {},
    keepalive = false,
  ): Promise<void> {
    const existing = active.get(key);
    if (existing) return existing;
    const write = async () => {
      // Bound each request, especially keepalive requests, and never erase unacknowledged events.
      let pending = entries();
      while (pending.length) {
        const batch: [string, Entry][] = [];
        for (const entry of pending) {
          if (
            batch.length >= 100 ||
            new TextEncoder().encode(JSON.stringify([...batch, entry])).length >
              24000
          )
            break;
          batch.push(entry);
        }
        if (!batch.length) throw new Error("暂存记录过大，无法同步");
        const result = await request(
          "sync",
          { id, events: batch.map(([, e]) => e) },
          keepalive,
        );
        remember(result);
        const ack = new Set(result.acknowledged || []);
        for (const [k, e] of batch)
          if (ack.has(e.eventId)) localStorage.removeItem(k);
        if (result.rejected?.length) {
          const archive = `toExcellence.rejected.${uid}.${id}`;
          const old = JSON.parse(
            localStorage.getItem(archive) || "[]",
          ) as Entry[];
          const rejected = batch.filter(([, e]) =>
            result.rejected!.includes(e.eventId),
          );
          localStorage.setItem(
            archive,
            JSON.stringify(
              [...old, ...rejected.map(([, e]) => e)].filter(
                (e, i, a) => a.findIndex((x) => x.eventId === e.eventId) === i,
              ),
            ),
          );
          rejected.forEach(([k]) => localStorage.removeItem(k));
        }
        accept(project(result));
        changed();
        if (!ack.size && !result.rejected?.length)
          throw new Error("服务器未确认保存，记录仍保留在浏览器");
        if (keepalive) break;
        pending = entries();
      }
    };
    const writer = navigator.locks
      ? navigator.locks.request(key, write)
      : write();
    const work = Promise.resolve(writer).finally(() => active.delete(key));
    active.set(key, work);
    return work;
  }
  return {
    load,
    cached,
    remember,
    project,
    enqueue,
    flush,
    entries,
    hasPending: () => keys().length > 0,
    hasRejected: () =>
      !!localStorage.getItem(`toExcellence.rejected.${uid}.${id}`),
  };
}
export async function flushAll(
  uid: string,
  request: Request,
  keepalive = false,
) {
  for (const id of pendingRuns(uid))
    await practiceSync(uid, id, request).flush(undefined, keepalive);
}
export function localHome(home: Home, uid: string, request: Request): Home {
  const mistakes = new Map(
    home.mistakes.map((m) => [m.bank + "/" + m.id, { ...m }]),
  );
  for (const id of pendingRuns(uid)) {
    const sync = practiceSync(uid, id, request),
      run = sync.cached();
    if (!run || run.mode === "exam") continue;
    for (const [, e] of sync.entries()) {
      if (e.op === "move") continue;
      const q = run.items.find((q) => q.id === e.question);
      if (!q) continue;
      const key = run.bank + "/" + q.id;
      let m = mistakes.get(key);
      if (
        e.op === "answer" &&
        JSON.stringify(e.answer) !== JSON.stringify(q.answer)
      ) {
        m = {
          ...m,
          id: q.id,
          bank: run.bank,
          stem: q.stem,
          unit: q.unit || "",
          streak: 0,
          mastery: 0,
        } as Mistake;
        mistakes.set(key, m);
      }
      if (e.op === "rate" && m) m.mastery = e.mastery;
    }
  }
  return { ...home, mistakes: [...mistakes.values()] };
}
