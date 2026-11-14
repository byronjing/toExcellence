import { useEffect, useState } from "react";
import { api, types, type Home } from "./api";
type RequestRow = {
  username: string;
  name: string;
  reason: string;
  state: string;
};
const labels: Record<string, string> = {
  pending: "待审批",
  processing: "审批中",
  approved: "已通过",
  rejected: "已驳回",
};
export default function Admin({
  home,
  refresh,
}: {
  home: Home;
  refresh: () => void;
}) {
  const [rows, setRows] = useState<RequestRow[]>([]),
    [msg, note] = useState(""),
    [busy, setBusy] = useState(false),
    [file, setFile] = useState<any>(null),
    [preview, setPreview] = useState(""),
    [bank, setBank] = useState(home.banks[0]?.id || "");
  const b = home.banks.find((x) => x.id === bank);
  async function load() {
    setRows(await api<RequestRow[]>("requests"));
  }
  useEffect(() => {
    load().catch((e) => note(e.message));
  }, []);
  async function task(fn: () => Promise<void>) {
    setBusy(true);
    note("");
    try {
      await fn();
    } catch (e) {
      note((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1>管理后台</h1>
      {msg && (
        <div className="notice" role="status">
          {msg}
        </div>
      )}
      <fieldset disabled={busy}>
        <section className="panel">
          <h2>账号审批</h2>
          {!rows.length && <p>暂无申请。</p>}
          {rows.map((r) => (
            <article className="request" key={r.username}>
              <b>
                {r.name} · {r.username}
              </b>
              <small>{labels[r.state]}</small>
              <p>{r.reason}</p>
              {["pending", "processing"].includes(r.state) && (
                <div className="actions">
                  {(r.state === "processing"
                    ? ["approve"]
                    : ["approve", "reject"]
                  ).map((op) => (
                    <button
                      key={op}
                      onClick={() =>
                        task(async () => {
                          await api(op, { username: r.username });
                          await load();
                        })
                      }
                    >
                      {op === "approve" ? "批准" : "驳回"}
                    </button>
                  ))}
                </div>
              )}
            </article>
          ))}
        </section>
        <section className="panel">
          <h2>直接创建普通账号</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = e.currentTarget;
              task(async () => {
                await api("direct", Object.fromEntries(new FormData(f)));
                f.reset();
                note("账号已创建");
              });
            }}
          >
            <div className="fields">
              <label>
                用户名
                <input required name="username" pattern="[a-zA-Z0-9_]{3,32}" />
              </label>
              <label>
                姓名
                <input required name="name" />
              </label>
              <label>
                密码
                <input
                  required
                  name="password"
                  minLength={8}
                  type="password"
                  autoComplete="new-password"
                />
              </label>
            </div>
            <button>创建账号</button>
          </form>
        </section>
        <section className="panel">
          <h2>导入 JSON 题库</h2>
          <a href="./bank-template.json" download>
            下载 JSON 模板
          </a>
          <label>
            选择题库文件
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                setFile(null);
                setPreview("");
                if (f)
                  task(async () => {
                    const data = JSON.parse(await f.text());
                    const r = await api<{ added: number; updated: number }>(
                      "preview",
                      data,
                    );
                    const counts: Record<string, number> = {
                      single: 0,
                      multi: 0,
                      judge: 0,
                    };
                    data.units.forEach((u: { questions: { type: string }[] }) =>
                      u.questions.forEach((q) => counts[q.type]++),
                    );
                    setFile(data);
                    setPreview(
                      data.name +
                        " · " +
                        data.units.length +
                        " 个单元 · " +
                        Object.entries(counts)
                          .map(([k, v]) => types[k] + " " + v)
                          .join(" / ") +
                        " · 新增 " +
                        r.added +
                        " · 更新 " +
                        r.updated,
                    );
                  });
              }}
            />
          </label>
          {preview && (
            <>
              <p>{preview}</p>
              <button
                onClick={() =>
                  task(async () => {
                    await api("import", file);
                    setPreview("");
                    setFile(null);
                    refresh();
                    note("题库已发布");
                  })
                }
              >
                确认发布
              </button>
            </>
          )}
        </section>
        <section className="panel">
          <h2>发布组卷方案</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              task(async () => {
                await api("plan", {
                  name: f.get("name"),
                  bank,
                  units: f.getAll("unit"),
                  minutes: Number(f.get("minutes")),
                  counts: Object.fromEntries(
                    Object.keys(types).map((k) => [k, Number(f.get(k))]),
                  ),
                });
                refresh();
                note("组卷方案已发布");
              });
            }}
          >
            <div className="fields">
              <label>
                方案名称
                <input required name="name" />
              </label>
              <label>
                覆盖题库
                <select value={bank} onChange={(e) => setBank(e.target.value)}>
                  {home.banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>抽题单元</label>
            <div className="unitchecks" key={bank}>
              {b?.units.map((u) => (
                <label key={u.id}>
                  <input
                    name="unit"
                    type="checkbox"
                    value={u.id}
                    defaultChecked
                  />
                  {u.name}
                </label>
              ))}
            </div>
            <div className="fields">
              {Object.entries(types).map(([k, v]) => (
                <label key={k}>
                  {v}数量
                  <input
                    type="number"
                    name={k}
                    min="0"
                    required
                    defaultValue={0}
                  />
                </label>
              ))}
              <label>
                时长（分钟）
                <input
                  name="minutes"
                  type="number"
                  min="1"
                  max="360"
                  defaultValue={25}
                  required
                />
              </label>
            </div>
            <button>发布方案</button>
          </form>
        </section>
      </fieldset>
    </>
  );
}
