import { createClient } from "@supabase/supabase-js";
const [user, name] = process.argv.slice(2);
const username = user?.trim().toLowerCase(),
  password = process.env.ADMIN_PASSWORD;
if (
  !username ||
  !/^[a-z0-9_]{3,32}$/.test(username) ||
  !name ||
  !password ||
  password.length < 8 ||
  Buffer.byteLength(password) > 72
)
  throw Error(
    "用法：配置 SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY、ADMIN_PASSWORD，然后 npm run admin -- 用户名 姓名",
  );
const client = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const { error } = await client.auth.admin.createUser({
  email: username + "@users.toexcellence.invalid",
  password,
  email_confirm: true,
  app_metadata: { provisioned: true, username, name, admin: true },
});
if (error) throw error;
console.log("管理员账号已创建：" + username);
