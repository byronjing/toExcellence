import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { LogOut, ChevronRight, ArrowLeft, RefreshCw } from "lucide-react";
import Login, { Mark } from "./Login";
import Admin from "./Admin";
import Practice from "./Practice";
import { api, db, go, modes, type Home, type Run } from "./api";
import "./style.css";
const path = () => location.hash.replace(/^#\/?/, "");
function App() {
  const [route, setRoute] = useState(path),
    [session, setSession] = useState<string | null | undefined>(),
    [home, setHome] = useState<Home | null>(null),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  useEffect(() => {
    const sub = db.auth.onAuthStateChange((_e, s) =>
      setSession(s?.user.id || null),
    );
    const h = () => setRoute(path());
    window.addEventListener("hashchange", h);
    return () => {
      sub.data.subscription.unsubscribe();
      window.removeEventListener("hashchange", h);
    };
  }, []);
  useEffect(() => {
    let live = true;
    setError("");
    if (session) {
      api<Home>("home")
        .then((h) => {
          if (live) setHome(h);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    } else setHome(null);
    return () => {
      live = false;
    };
  }, [session, route, reload]);
  if (session === null) return <Login />;
  return (
    <>
      <header className="publichead">
        <button className="bare" onClick={() => go("")}>
          <Mark />
        </button>
        <div className="row">
          {home?.user.name}
          <button
            className="bare"
            onClick={() => db.auth.signOut({ scope: "local" })}
          >
            <LogOut size={17} />
            退出
          </button>
        </div>
      </header>
      <main className="workspace">
        {route && (
          <button className="backlink" onClick={() => go("")}>
            <ArrowLeft size={16} />
            学习首页
          </button>
        )}
        {error && (
          <div className="notice">
            {error}{" "}
            <button onClick={() => setReload((n) => n + 1)}>
              <RefreshCw size={14} />
              重试
            </button>
          </div>
        )}
        {!home ? (
          <p>正在载入学习空间…</p>
        ) : route === "admin" && home.user.admin ? (
          <Admin home={home} refresh={() => setReload((n) => n + 1)} />
        ) : route.startsWith("run/") ? (
          <Practice key={route} id={route.slice(4)} />
        ) : (
          <Dashboard home={home} />
        )}
      </main>
    </>
  );
}
function Dashboard({ home: h }: { home: Home }) {
  const [mode, setMode] = useState("unit"),
    [bid, bank] = useState(h.banks[0]?.id || ""),
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
                setMode(k);
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
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
