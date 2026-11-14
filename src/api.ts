import { createClient } from "@supabase/supabase-js";
export const db = createClient(
  import.meta.env.VITE_SUPABASE_URL ||
    "https://omuyuybdustwqnecesny.supabase.co",
  import.meta.env.VITE_SUPABASE_KEY ||
    "sb_publishable_y1-Ddfy_VF-H0v35fR94og_yhIMY4VV",
);
export async function api<T>(op: string, p: unknown = {}): Promise<T> {
  const { data, error } = await db.functions.invoke("api", { body: { op, p } });
  if (error) {
    let message = "连接失败，请检查网络后重试";
    try {
      message = (await error.context.json()).error || message;
    } catch {}
    throw new Error(message);
  }
  return data;
}
export interface Unit {
  id: string;
  name: string;
  count: number;
}
export interface Bank {
  id: string;
  name: string;
  units: Unit[];
}
export interface Plan {
  id: string;
  name: string;
  bank: string;
  minutes: number;
  counts: Record<string, number>;
}
export interface Home {
  user: { name: string; admin: boolean };
  banks: Bank[];
  plans: Plan[];
  mistakes: { id: string; stem: string; bank: string; streak: number }[];
  history: {
    id: string;
    mode: string;
    bank: string;
    finished: boolean;
    pos: number;
    total: number;
    created: string;
  }[];
}
export interface Question {
  id: string;
  type: string;
  stem: string;
  options: string[];
  answer?: string[];
  explanation?: string;
  supplement?: boolean;
}
export interface Run {
  bank: string;
  id: string;
  mode: string;
  pos: number;
  total: number;
  items: Question[];
  answers: Record<string, string[]>;
  deadline: string | null;
  serverTime: string;
  finished: boolean;
}
export const types: Record<string, string> = {
  single: "单选题",
  multi: "多选题",
  judge: "判断题",
};
export const modes: Record<string, string> = {
  unit: "单元练习",
  random: "随机无限练习",
  exam: "限时组卷",
  wrong: "错题重练",
};
export function go(path: string) {
  location.hash = "/" + path;
}
