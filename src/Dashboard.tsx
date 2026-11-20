import { useEffect, useState } from "react";
import { api, go, modes, type Home, type Run } from "./api";
import { flushAll, localHome } from "./practiceSync";
import { exportMistakes } from "./mistakeExport";
import { ChevronRight } from "./material";
export default function Dashboard({
  home,
  uid,
  initialMode,
  initialBank,
}: {
  home: Home;
  uid: string;
  initialMode: string;
  initialBank?: string;
}) {
  const [, rerender] = useState(0);
  useEffect(() => {
    const refresh = () => rerender((n) => n + 1);
    window.addEventListener("study-local", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("study-local", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  const h = localHome(home, uid, api<Run>);
  const [query, setQuery] = useState(""),
    [level, setLevel] = useState(-1),
    [filterUnit, setFilterUnit] = useState("");
  const [selected, setSelected] = useState<string[]>([]),
    [exporting, setExporting] = useState(false),
    [message, setMessage] = useState("");
  const mode = initialMode;
  const [bid, bank] = useState(initialBank || h.banks[0]?.id || ""),
    [unit, setUnit] = useState(""),
    [plan, setPlan] = useState(""),
    [err, setErr] = useState(""),
    [busy, setBusy] = useState(false);
  const b = h.banks.find((b) => b.id === bid) || h.banks[0],
    plans = h.plans.filter((p) => p.bank === b?.id),
    mistakes = h.mistakes
      .filter((m) => m.bank === b?.id)
      .sort((a, b) => a.mastery - b.mastery || a.id.localeCompare(b.id));
  const visible = mistakes.filter(
    (m) =>
      (level < 0 || m.mastery === level) &&
      (!filterUnit || m.unit === filterUnit) &&
      m.stem.toLowerCase().includes(query.trim().toLowerCase()),
  );
  async function download() {
    if (!b || !selected.length) return;
    setExporting(true);
    setErr("");
    try {
      const status = await exportMistakes(uid, b.id, selected);
      setMessage(
        status === "synced"
          ? "JSON 文件已导出"
          : "JSON 已导出，包含本地缓存；同步状态和历史完整性已在文件中标注",
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  async function start() {
    setBusy(true);
    setErr("");
    try {
      await flushAll(uid, api<Run>);
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
                setSelected([]);
                setFilterUnit("");
                setMessage("");
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
            待重练 {mistakes.filter((m) => m.mastery < 3).length} 题 · 已掌握{" "}
            {mistakes.filter((m) => m.mastery === 3).length} 题
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
            (mode === "wrong" &&
              !mistakes.some((m) => m.mastery < 3) &&
              !h.history.some(
                (s) => s.mode === "wrong" && s.bank === b?.id && !s.finished,
              ))
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
          <div className="mastery-board" aria-label="掌握度数据看板">
            <button aria-pressed={level === -1} onClick={() => setLevel(-1)}>
              全部 <strong>{mistakes.length}</strong>
            </button>
            {[0, 1, 2, 3].map((n) => (
              <button
                key={n}
                aria-pressed={level === n}
                onClick={() => setLevel(n)}
              >
                {n ? `${n}星` : "未评分"}{" "}
                <strong>
                  {mistakes.filter((m) => m.mastery === n).length}
                </strong>
              </button>
            ))}
          </div>
          <div className="fields">
            <label>
              搜索错题
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="题干关键词"
              />
            </label>
            <label>
              单元
              <select
                value={filterUnit}
                onChange={(e) => setFilterUnit(e.target.value)}
              >
                <option value="">全部单元</option>
                {b?.units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="actions">
            <button
              onClick={() =>
                setSelected((s) => [
                  ...new Set([...s, ...visible.map((m) => m.id)]),
                ])
              }
            >
              全选筛选结果
            </button>
            <button onClick={() => setSelected([])}>清空选择</button>
            <button disabled={!selected.length || exporting} onClick={download}>
              {exporting ? "正在导出…" : `导出 JSON（${selected.length}题）`}
            </button>
          </div>
          <p>
            <small>按掌握度升序排列 · 三星题保留在错题本中，可随时导出</small>
          </p>
          {message && <p role="status">{message}</p>}
          {!visible.length && <p>当前筛选没有错题。</p>}
          {visible.map((m) => (
            <label className="mistake-row" key={m.id}>
              <input
                type="checkbox"
                checked={selected.includes(m.id)}
                onChange={(e) =>
                  setSelected((s) =>
                    e.target.checked
                      ? [...s, m.id]
                      : s.filter((id) => id !== m.id),
                  )
                }
              />
              <span>
                <strong>
                  {m.mastery
                    ? "★".repeat(m.mastery) + "☆".repeat(3 - m.mastery)
                    : "未评分"}
                </strong>
                　{m.stem}
                <small>连续答对 {m.streak} 次</small>
              </span>
            </label>
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
