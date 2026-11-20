import { useEffect, useState, useRef, useMemo } from "react";
import { api, go, modes, types, type Run } from "./api";
import { practiceSync } from "./practiceSync";
export default function Practice({ id, uid }: { id: string; uid: string }) {
  const sync = useMemo(() => practiceSync(uid, id, api<Run>), [uid, id]);
  const live = useRef(false);
  const [syncing, setSyncing] = useState(false);
  const [run, set] = useState<Run | null>(null),
    [picked, pick] = useState<string[]>([]),
    [busy, wait] = useState(false),
    [err, error] = useState(""),
    [tick, time] = useState(Date.now()),
    [confirm, setConfirm] = useState(false),
    [review, at] = useState(0);
  const offset = useRef(0),
    locked = useRef(false);
  function accept(r: Run) {
    offset.current = Date.parse(r.serverTime) - (r.receivedAt ?? Date.now());
    set(sync.project(r));
    time(Date.now());
  }
  async function flush() {
    setSyncing(true);
    try {
      await sync.flush((r) => {
        if (live.current) accept(r);
      });
      if (live.current) error("");
    } catch (e) {
      if (live.current) error((e as Error).message);
      throw e;
    } finally {
      if (live.current) setSyncing(false);
    }
  }
  function change(c: Parameters<typeof sync.enqueue>[0]) {
    if (!run || locked.current) return;
    try {
      sync.enqueue(c);
      set(sync.project(run));
      pick([]);
    } catch (e) {
      error((e as Error).message);
    }
  }
  async function act(op: string, p: Record<string, unknown> = {}) {
    if (locked.current) return;
    locked.current = true;
    wait(true);
    error("");
    try {
      if (op !== "get") await flush();
      const r =
        op === "get" ? await sync.load() : await api<Run>(op, { id, ...p });
      if (live.current && r.id === id) {
        accept(r);
      }
      return r;
    } catch (e) {
      if (live.current) error((e as Error).message);
    } finally {
      locked.current = false;
      if (live.current) wait(false);
    }
  }
  useEffect(() => {
    live.current = true;
    void act("get");
    const refresh = () => {
      const cached = sync.cached();
      if (cached && live.current) accept(cached);
    };
    window.addEventListener("study-local", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      live.current = false;
      window.removeEventListener("study-local", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [sync]);
  useEffect(() => {
    if (run?.mode !== "exam" || run.finished) return;
    const timer = setInterval(() => {
      if (sync.hasPending()) void flush().catch(() => {});
    }, 30000);
    return () => clearInterval(timer);
  }, [sync, run?.mode, run?.finished]);
  useEffect(() => {
    if (!run?.deadline || run.finished) return;
    const h = setInterval(() => time(Date.now()), 1000);
    return () => clearInterval(h);
  }, [run?.deadline, run?.finished]);
  const left = run?.deadline
    ? Math.max(
        0,
        Math.ceil((Date.parse(run.deadline) - tick - offset.current) / 1000),
      )
    : null;
  useEffect(() => {
    if (
      left !== null &&
      left <= 2 &&
      left > 0 &&
      !run?.finished &&
      sync.hasPending()
    )
      void flush().catch(() => {});
    if (left === 0 && !run?.finished && !busy && !err) void act("finish");
  }, [left, run?.finished, busy, err]);
  if (!run)
    return (
      <section className="panel">
        {err || "正在读取进度…"}
        {err && <button onClick={() => act("get")}>重试</button>}
      </section>
    );
  const exam = run.mode === "exam",
    idx = run.finished ? review : run.pos,
    q = run.items[idx],
    saved = run.answers[q.id],
    graded = !!q.answer && (run.finished || !!saved),
    submitted = graded || (!exam && !!saved),
    wrong = graded && JSON.stringify(q.answer) !== JSON.stringify(saved),
    markWrong = wrong && !!saved?.length,
    selected = submitted || exam ? saved || [] : picked;
  const score = run.items.filter(
    (x) =>
      x.answer &&
      JSON.stringify(x.answer) === JSON.stringify(run.answers[x.id]),
  ).length;
  function choose(a: string) {
    if (submitted || busy) return;
    const next =
      q.type === "multi"
        ? selected.includes(a)
          ? selected.filter((v) => v !== a)
          : [...selected, a].sort()
        : [a];
    if (exam) {
      change({ op: "answer", question: q.id, answer: next });
    } else pick(next);
  }
  async function finish() {
    const r = await act("finish");
    setConfirm(false);
    if (r?.finished && r.mode === "random") {
      const n = await act("start", { mode: "random", bank: r.bank });
      if (n) go("run/" + n.id);
    }
  }
  return (
    <section className="panel practice">
      <div className="spread">
        <span className="kicker">{modes[run.mode]}</span>
        <small>
          {err
            ? "操作失败，暂存记录保留"
            : busy || syncing
              ? "正在同步…"
              : sync.hasPending()
                ? "已保存在浏览器"
                : "已同步到云端"}{" "}
          {left !== null &&
            !run.finished &&
            " · 剩余 " +
              Math.floor(left / 60) +
              ":" +
              String(left % 60).padStart(2, "0")}
        </small>
      </div>
      {run.finished && (
        <h2>
          已完成 · {score} / {run.total} 分
        </h2>
      )}
      <progress max={run.total} value={idx + 1} />
      <div className="row">
        <small>
          {types[q.type]} · {idx + 1} / {run.total}
        </small>
        {q.supplement && <small>补充题</small>}
      </div>
      <h2 className={markWrong ? "wrong-text" : undefined}>{q.stem}</h2>
      <div className="options">
        {q.options.map((v, i) => {
          const a = String.fromCharCode(65 + i);
          return (
            <button
              key={a}
              disabled={busy || submitted}
              className={
                (selected.includes(a) ? "selected " : "") +
                (graded && q.answer?.includes(a) ? "correct " : "") +
                (markWrong && q.type === "single"
                  ? q.answer?.includes(a)
                    ? "correct-text"
                    : selected.includes(a)
                      ? "wrong-text"
                      : ""
                  : "")
              }
              onClick={() => choose(a)}
            >
              <b>{a}</b>
              {v}
            </button>
          );
        })}
      </div>
      {graded && (
        <div className="feedback">
          <b>{wrong ? "回答错误" : "回答正确"}</b>
          　正确答案 {q.answer?.join("、")}　你的答案{" "}
          {saved?.join("、") || "未答"}
          {q.explanation && <p>{q.explanation}</p>}
        </div>
      )}
      {run.mode === "wrong" && graded && (
        <div className="mastery-rating" role="group" aria-label="掌握度评分">
          <span>掌握度</span>
          {[1, 2, 3].map((star) => (
            <button
              key={star}
              type="button"
              aria-label={`${star}星${star === 3 ? "，已掌握" : ""}`}
              aria-pressed={(run.mastery[q.id] || 0) === star}
              className={
                star <= (run.mastery[q.id] || 0) ? "star filled" : "star"
              }
              disabled={busy}
              onClick={() =>
                change({ op: "rate", question: q.id, mastery: star })
              }
            >
              ★
            </button>
          ))}
          <small>
            {run.mastery[q.id] ? `${run.mastery[q.id]} / 3 星` : "未评分"} ·
            三星表示已掌握
          </small>
        </div>
      )}
      {sync.hasRejected() && (
        <p className="notice">
          部分作答未在截止前被服务器接收，未计入成绩；记录仍保存在此浏览器。
        </p>
      )}
      {err && (
        <p className="notice">
          {err} <button onClick={() => act("get")}>重新读取云端进度</button>
        </p>
      )}
      <div className="actions">
        {idx > 0 && (
          <button
            disabled={busy}
            onClick={() =>
              run.finished ? at(idx - 1) : change({ op: "move", pos: idx - 1 })
            }
          >
            上一题
          </button>
        )}
        {!run.finished && !exam && !submitted && (
          <button
            className="primary"
            disabled={!picked.length || busy}
            onClick={() =>
              change({ op: "answer", question: q.id, answer: picked })
            }
          >
            提交答案
          </button>
        )}
        {(exam || submitted) && idx < run.total - 1 && (
          <button
            disabled={busy}
            onClick={() =>
              run.finished ? at(idx + 1) : change({ op: "move", pos: idx + 1 })
            }
          >
            下一题
          </button>
        )}
        {!run.finished && (exam || (submitted && idx === run.total - 1)) && (
          <button
            className="primary"
            disabled={busy}
            onClick={() => (exam ? setConfirm(true) : finish())}
          >
            {exam ? "交卷" : run.mode === "random" ? "继续下一轮" : "完成本轮"}
          </button>
        )}
        {run.finished && <button onClick={() => go("")}>返回首页</button>}
      </div>
      {confirm && (
        <div className="notice">
          还有 {run.items.filter((x) => !run.answers[x.id]?.length).length}{" "}
          题未答，确认交卷？{" "}
          <button disabled={busy} onClick={finish}>
            确认交卷
          </button>{" "}
          <button onClick={() => setConfirm(false)}>继续作答</button>
        </div>
      )}
    </section>
  );
}
