import { useState, type FormEvent } from "react";
import {
  md,
  SymbolIcon,
  BookOpen,
  Check,
  CheckCheck,
  Clock3,
  Layers3,
  LockKeyhole,
  NotebookPen,
  Shuffle,
  Sparkles,
} from "./material";
import { db, api, modes } from "./api";
export function Mark() {
  return (
    <span className="brand">
      <span className="brandicon">
        <Layers3 size={22} />
      </span>
      toExcellence
    </span>
  );
}
const features = [
  {
    icon: BookOpen,
    key: "unit",
    text: "跟随课程章节，逐题巩固知识。",
    color: "green",
  },
  {
    icon: Shuffle,
    key: "random",
    text: "打乱出题顺序，随时开启练习。",
    color: "orange",
  },
  {
    icon: Clock3,
    key: "exam",
    text: "按考试方案，进行限时自测。",
    color: "blue",
  },
  {
    icon: NotebookPen,
    key: "wrong",
    text: "回顾薄弱知识，追踪掌握进度。",
    color: "purple",
  },
];
export default function Login() {
  const [apply, setApply] = useState(false),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [msg, setMsg] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    const f = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (apply) {
        await api("apply", f);
        setApply(false);
        setMsg("已提交，等待管理员审批。");
      } else {
        const { error } = await db.auth.signInWithPassword({
          email:
            String(f.username).trim().toLowerCase() +
            "@users.toexcellence.invalid",
          password: String(f.password),
        });
        if (error)
          throw new Error(
            error.status === 400
              ? "账号或密码错误，或申请尚未通过审批。"
              : "登录服务连接失败，请稍后重试。",
          );
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="publichead">
        <Mark />
        <span className="headnote">
          <span className="dot" /> 在线自习室
        </span>
      </header>
      <main className="landing">
        <div className="hero">
          <section className="poster">
            <div className="posterlabel">
              <span /> LEARNING STUDIO
            </div>
            <h1>
              在线刷题
              <br />
              <em>
                自习室<span>.</span>
              </em>
            </h1>
            <p>
              按单元学习，随时练习。
              <br />
              在一次次作答中，稳步掌握每个知识点。
            </p>
            <div className="art" aria-hidden="true">
              <div className="orbit" />
              <div className="paper back" />
              <div className="paper front">
                <div className="paperhead">
                  <BookOpen size={14} /> STUDY NOTES
                </div>
                <b>
                  Q<span>.</span>
                </b>
                <div className="rule" />
                <div className="rule small" />
                <div className="fakecheck">
                  <Check size={13} />
                  <i />
                </div>
              </div>
              <div className="seal">
                <CheckCheck />
              </div>
              <Sparkles className="spark" />
            </div>
            <div className="posterfoot">
              <span /> toExcellence 学习空间
            </div>
          </section>
          <section className="auth">
            <div className="authicon">
              <LockKeyhole size={20} />
            </div>
            <h2>{apply ? "申请学习账号" : "登录自习室"}</h2>
            <p>
              {apply
                ? "提交申请，等待管理员审批。"
                : "使用已获批准的账号继续学习。"}
            </p>
            <form onSubmit={submit}>
              {md(
                "md-outlined-text-field",
                {
                  label: "用户名",
                  name: "username",
                  required: true,
                  minLength: 3,
                  maxLength: 32,
                  pattern: "[A-Za-z0-9_]{3,32}",
                  autocomplete: "username",
                },
                <SymbolIcon slot="leading-icon" name="person" />,
              )}
              {md(
                "md-outlined-text-field",
                {
                  label: "密码",
                  name: "password",
                  required: true,
                  type: show ? "text" : "password",
                  minLength: apply ? 8 : 1,
                  autocomplete: apply ? "new-password" : "current-password",
                },
                <SymbolIcon slot="leading-icon" name="lock" />,
                md(
                  "md-icon-button",
                  {
                    slot: "trailing-icon",
                    type: "button",
                    "aria-label": show ? "隐藏密码" : "显示密码",
                    onClick: () => setShow(!show),
                  },
                  <SymbolIcon name={show ? "visibility_off" : "visibility"} />,
                ),
              )}
              {apply && (
                <>
                  {md("md-outlined-text-field", {
                    label: "姓名",
                    required: true,
                    name: "name",
                    maxLength: 80,
                  })}
                  {md("md-outlined-text-field", {
                    label: "申请理由",
                    required: true,
                    name: "reason",
                    type: "textarea",
                    rows: 2,
                    maxLength: 1000,
                  })}
                </>
              )}
              {msg && (
                <div role="status" className="notice">
                  {msg}
                </div>
              )}
              {md(
                "md-filled-button",
                { type: "submit", disabled: busy },
                busy ? "正在处理…" : apply ? "提交申请" : "登录",
                <SymbolIcon slot="icon" name="arrow_forward" />,
              )}
            </form>
            <div className="authfoot">
              {apply ? "已有学习账号？" : "还没有账号？"}{" "}
              {md(
                "md-text-button",
                {
                  onClick: () => {
                    setApply(!apply);
                    setMsg("");
                  },
                },
                apply ? "返回登录" : "申请注册",
                <SymbolIcon slot="icon" name="north_east" />,
              )}
            </div>
          </section>
        </div>
        <section className="features">
          <div className="sectiontitle">
            <i />
            <h2>练习模式</h2>
          </div>
          <div className="featuregrid">
            {features.map(({ icon: Icon, key, text, color }) => (
              <article key={key}>
                <span className={"tile " + color}>
                  <Icon size={21} />
                </span>
                <h3>{modes[key]}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
      <footer>
        toExcellence <span>在线学习与练习系统</span>
      </footer>
    </>
  );
}
