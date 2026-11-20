import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Shell from "./Shell";
import Login from "./Login";

import { api, db, type Home, type Run } from "./api";
import { flushAll } from "./practiceSync";
import "./theme.css";
import "./style.css";
import "./studio.css";
const path = () => location.hash.replace(/^#\/?/, "");
function App() {
  const [route, setRoute] = useState(path),
    [session, setSession] = useState<string | null | undefined>(),
    [home, setHome] = useState<Home | null>(null),
    [homeOwner, setHomeOwner] = useState<string | null>(null),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  useEffect(() => {
    const sub = db.auth.onAuthStateChange((_e, s) =>
      setSession(s?.user.id || null),
    );
    let depth = history.state?.studyDepth ?? 0;
    history.replaceState({ ...history.state, studyDepth: depth }, "");
    const h = () => {
      const next = history.state?.studyDepth ?? depth + 1;
      document.documentElement.toggleAttribute("data-back", next < depth);
      depth = next;
      history.replaceState({ ...history.state, studyDepth: depth }, "");
      setRoute(path());
    };
    window.addEventListener("hashchange", h);
    return () => {
      sub.data.subscription.unsubscribe();
      window.removeEventListener("hashchange", h);
    };
  }, []);
  useEffect(() => {
    if (!session) return;
    let live = true;
    const flush = (keepalive = false) => {
      void flushAll(session, api<Run>, keepalive)
        .then(() => {
          if (live && !path().startsWith("run/")) setReload((n) => n + 1);
        })
        .catch((e) => {
          if (live) setError("同步失败，已保留本地记录：" + e.message);
        });
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") flush(true);
    };
    const leave = () => flush(true);
    const online = () => {
      if (!path().startsWith("run/")) flush();
    };
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leave);
    if (!route.startsWith("run/")) flush();
    return () => {
      live = false;
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leave);
    };
  }, [session, route]);
  useEffect(() => {
    let live = true;
    setError("");
    if (session) {
      api<Home>("home")
        .then((h) => {
          if (live) {
            setHome(h);
            setHomeOwner(session);
            try {
              localStorage.setItem(
                "toExcellence.home.v1." + session,
                JSON.stringify(h),
              );
            } catch {
              /* Answer saves report storage failures separately. */
            }
          }
        })
        .catch((e) => {
          if (live) {
            try {
              const cached = JSON.parse(
                localStorage.getItem("toExcellence.home.v1." + session) ||
                  "null",
              );
              if (cached) {
                setHome(cached);
                setHomeOwner(session);
              }
            } catch {
              /* Keep the recoverable load error. */
            }
            setError(e.message);
          }
        });
    } else setHome(null);
    return () => {
      live = false;
    };
  }, [session, route, reload]);
  if (session === null) return <Login />;
  if (!home || !session || homeOwner !== session)
    return (
      <main className="loading" role="status">
        {error || "正在载入学习空间…"}
        {error && <button onClick={() => setReload((n) => n + 1)}>重试</button>}
      </main>
    );
  return (
    <Shell
      key={session}
      uid={session}
      home={home}
      route={route}
      error={error}
      refresh={() => setReload((n) => n + 1)}
    />
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
