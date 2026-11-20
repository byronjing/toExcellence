import { createClient } from "npm:@supabase/supabase-js@2.99.1";
import { validateBank } from "./bank.ts";
const url = Deno.env.get("SUPABASE_URL")!,
  secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { ...cors, "Cache-Control": "no-store" },
  });
const email = (name: string) => name + "@users.toexcellence.invalid";
const allowed = new Set([
  "home",
  "sync",
  "rate",
  "export",
  "start",
  "get",
  "answer",
  "move",
  "finish",
  "requests",
  "plan",
  "reject",
  "preview",
  "import",
  "apply",
  "approve",
  "direct",
]);
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return reply({ error: "仅支持 POST" }, 405);
  try {
    const { op, p = {} } = await req.json();
    if (!allowed.has(op)) return reply({ error: "未知操作" }, 400);
    let uid: string | null = null;
    if (op !== "apply") {
      const token = req.headers.get("Authorization")?.replace(/^Bearer /i, "");
      if (!token) return reply({ error: "请先登录" }, 401);
      const { data, error } = await db.auth.getUser(token);
      if (error || !data.user)
        return reply({ error: "登录已过期，请重新登录" }, 401);
      uid = data.user.id;
    }
    const rpc = async (action: string, input: unknown) => {
      const { data, error } = await db.rpc("study_api", {
        uid,
        op: action,
        p: input,
      });
      if (error) throw new Error(error.message);
      return data;
    };
    if (op === "apply" || op === "direct") {
      const username = String(p.username || "")
          .trim()
          .toLowerCase(),
        name = String(p.name || "").trim(),
        reason = String(p.reason || "").trim();
      if (!/^[a-z0-9_]{3,32}$/.test(username))
        throw new Error("用户名需为 3–32 位字母、数字或下划线");
      if (
        !name ||
        name.length > 80 ||
        typeof p.password !== "string" ||
        p.password.length < 8 ||
        p.password.length > 72 ||
        new TextEncoder().encode(p.password).length > 72
      )
        throw new Error("请输入姓名及 8–72 字节的密码");
      if (op === "apply") {
        if (!reason || reason.length > 1000)
          throw new Error("请填写申请理由（最多 1000 字）");
        const { error } = await db.rpc("study_apply", {
          uname: username,
          display_name: name,
          reason_text: reason,
          pwd: p.password,
        });
        if (error) throw new Error(error.message);
      } else {
        await rpc("direct", { username });
        const { error } = await db.auth.admin.createUser({
          email: email(username),
          password: p.password,
          email_confirm: true,
          app_metadata: { provisioned: true, username, name },
        });
        if (error) throw new Error("建号失败，请确认用户名未被占用");
      }
      return reply(true);
    }
    if (op === "approve") {
      const { data: r, error } = await db.rpc("study_claim", {
        actor: uid,
        uname: p.username,
      });
      if (error) throw new Error(error.message);
      if (r && !r.exists) {
        const { error: e } = await db.auth.admin.createUser({
          email: email(r.username),
          password: r.password,
          email_confirm: true,
          app_metadata: {
            provisioned: true,
            username: r.username,
            name: r.name,
          },
        });
        if (e) {
          const { data: retry } = await db.rpc("study_claim", {
            actor: uid,
            uname: p.username,
          });
          if (retry && !retry.exists) throw new Error("建号未完成，可重试审批");
        }
      }
      await rpc("approved", { username: p.username });
      return reply(true);
    }
    if (op === "plan" && (typeof p.name !== "string" || !p.name.trim()))
      throw new Error("请输入方案名称");
    return reply(
      await rpc(op, op === "preview" || op === "import" ? validateBank(p) : p),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "操作失败";
    return reply({ error: msg }, msg.includes("权限") ? 403 : 400);
  }
});
