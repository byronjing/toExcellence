import { useEffect, useState, useRef } from "react";
import { api, go, modes, types, type Run } from "./api";
export default function Practice({ id }: { id: string }) {
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
    offset.current = Date.parse(r.serverTime) - Date.now();
    set(r);
    pick(r.answers[r.items[r.pos].id] || []);
    time(Date.now());
  }
  async function act(op: string, p: Record<string, unknown> = {}) {
    if (locked.current) return;
    locked.current = true;
    wait(true);
    error("");
    try {
      const r = await api<Run>(op, { id, ...p });
      accept(r);
      return r;
    } catch (e) {
      error((e as Error).message);
    } finally {
      locked.current = false;
      wait(false);
    }
  }
  useEffect(() => {
    void act("get");
  }, [id]);
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
    if (left === 0 && !run?.finished && !busy && !err) void act("get");
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
    graded = !!q.answer,
    selected = graded ? saved || [] : picked;
  const score = run.items.filter(
    (x) =>
      x.answer &&
      JSON.stringify(x.answer) === JSON.stringify(run.answers[x.id]),
  ).length;
  async function choose(a: string) {
    if (graded || busy) return;
    const next =
      q.type === "multi"
        ? picked.includes(a)
          ? picked.filter((v) => v !== a)
          : [...picked, a].sort()
        : [a];
    if (exam) {
      await act("answer", { question: q.id, answer: next });
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
          {busy ? "正在同步…" : err ? "同步失败" : "已同步到云端"}{" "}
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
      <h2>{q.stem}</h2>
      <div className="options">
        {q.options.map((v, i) => {
          const a = String.fromCharCode(65 + i);
          return (
            <button
              key={a}
              disabled={busy || graded}
              className={
                (selected.includes(a) ? "selected " : "") +
                (graded && q.answer?.includes(a) ? "correct" : "")
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
          <b>
            {JSON.stringify(q.answer) === JSON.stringify(saved)
              ? "回答正确"
              : "回答错误"}
          </b>
          　正确答案 {q.answer?.join("、")}　你的答案{" "}
          {saved?.join("、") || "未答"}
          {q.explanation && <p>{q.explanation}</p>}
        </div>
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
              run.finished ? at(idx - 1) : act("move", { pos: idx - 1 })
            }
          >
            上一题
          </button>
        )}
        {!run.finished && !exam && !graded && (
          <button
            className="primary"
            disabled={!picked.length || busy}
            onClick={() => act("answer", { question: q.id, answer: picked })}
          >
            提交答案
          </button>
        )}
        {(exam || graded) && idx < run.total - 1 && (
          <button
            disabled={busy}
            onClick={() =>
              run.finished ? at(idx + 1) : act("move", { pos: idx + 1 })
            }
          >
            下一题
          </button>
        )}
        {!run.finished && (exam || (graded && idx === run.total - 1)) && (
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
