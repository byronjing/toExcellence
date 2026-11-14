import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Shell from "./Shell";
import Login from "./Login";

import { api, db, type Home } from "./api";
import "./theme.css";
import "./style.css";
import "./studio.css";
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
  if (!home || !session)
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
