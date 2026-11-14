import { useState } from "react";
import { api, go, modes, type Home, type Run } from "./api";
import { ChevronRight } from "./material";
export default function Dashboard({
  home: h,
  initialMode,
  initialBank,
}: {
  home: Home;
  initialMode: string;
  initialBank?: string;
}) {
  const mode = initialMode;
  const [bid, bank] = useState(initialBank || h.banks[0]?.id || ""),
    [unit, setUnit] = useState(""),
    [plan, setPlan] = useState(""),
    [err, setErr] = useState(""),
    [busy, setBusy] = useState(false);
  const b = h.banks.find((b) => b.id === bid) || h.banks[0],
    plans = h.plans.filter((p) => p.bank === b?.id),
    mistakes = h.mistakes.filter((m) => m.bank === b?.id);
  async function start() {
    setBusy(true);
    setErr("");
    try {
      const s = await api<Run>("start", {
        bank: b?.id,
        mode,
        unit: unit || b?.units[0]?.id,
        plan: plan || plans[0]?.id,
      });
      go("run/" + s.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="spread">
        <h1>学习自习室</h1>
        {h.user.admin && (
          <button onClick={() => go("admin")}>
            管理后台 <ChevronRight size={14} />
          </button>
        )}
      </div>
      <section className="panel">
        <div className="tabs">
          {Object.entries(modes).map(([k, v]) => (
            <button
              key={k}
              className={k === mode ? "active" : ""}
              onClick={() => {
                go(k + (b ? "/" + b.id : ""));
                setErr("");
              }}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="fields">
          <label>
            题库
            <select
              value={b?.id || ""}
              onChange={(e) => {
                bank(e.target.value);
                setUnit("");
                setPlan("");
              }}
            >
              {h.banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          {mode === "unit" && (
            <label>
              学习单元
              <select
                value={unit || b?.units[0]?.id || ""}
                onChange={(e) => setUnit(e.target.value)}
              >
                {b?.units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {u.count} 题
                  </option>
                ))}
              </select>
            </label>
          )}
          {mode === "exam" && (
            <label>
              考试方案
              <select
                value={plan || plans[0]?.id || ""}
                onChange={(e) => setPlan(e.target.value)}
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.minutes} 分钟
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {mode === "wrong" && (
          <p>
            待重练 {mistakes.filter((m) => m.streak < 3).length} 题 · 已掌握{" "}
            {mistakes.filter((m) => m.streak === 3).length} 题
          </p>
        )}
        {mode === "exam" && !plans.length && (
          <p>管理员尚未发布本题库的组卷方案。</p>
        )}
        <button
          className="primary"
          disabled={
            busy ||
            !b ||
            (mode === "exam" && !plans.length) ||
            (mode === "wrong" && !mistakes.some((m) => m.streak < 3))
          }
          onClick={start}
        >
          开始或继续练习 <ChevronRight size={17} />
        </button>
        {err && <p role="alert">{err}</p>}
      </section>
      {mode === "wrong" && (
        <section className="panel">
          <h2>我的错题</h2>
          {mistakes.map((m) => (
            <p key={m.id}>
              <strong>{m.streak === 3 ? "已掌握" : m.streak + "/3"}</strong>　
              {m.stem}
            </p>
          ))}
        </section>
      )}
      <h2>学习记录</h2>
      {!h.history.length ? (
        <p>完成首次作答后，可在这里查看进度。</p>
      ) : (
        h.history.map((s) => (
          <button
            className="history"
            key={s.id}
            onClick={() => go("run/" + s.id)}
          >
            <span>
              {modes[s.mode]} · {h.banks.find((b) => b.id === s.bank)?.name}
              <small>{new Date(s.created).toLocaleString("zh-CN")}</small>
            </span>
            <span>
              {s.finished ? "查看结果" : "继续练习"} <ChevronRight size={14} />
            </span>
          </button>
        ))
      )}
    </>
  );
}
