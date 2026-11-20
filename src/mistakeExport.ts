import { api, type Run } from "./api";
import {
  flushAll,
  pendingRuns,
  practiceSync,
  type Entry,
} from "./practiceSync";
export type ExportQuestion = {
  id: string;
  bank: string;
  bankName?: string;
  unit?: string;
  unitName?: string;
  question: Run["items"][number];
  mastery: number;
  masterySource?: string;
  masteryUpdatedAt?: string | null;
  streak: number;
  attempts: Record<string, unknown>[];
};
export function mergeLocal(
  records: ExportQuestion[],
  uid: string,
  bank: string,
  ids: string[],
) {
  const result = new Map(
    records.map((r) => [r.id, { ...r, attempts: [...r.attempts] }]),
  );
  for (const id of pendingRuns(uid)) {
    const sync = practiceSync(uid, id, api<Run>),
      run = sync.cached();
    if (!run || run.bank !== bank || run.mode === "exam") continue;
    for (const [, e] of sync.entries()) {
      if (e.op === "move" || !ids.includes(e.question)) continue;
      const q = run.items.find((q) => q.id === e.question);
      if (!q) continue;
      let record = result.get(q.id);
      if (!record) {
        record = {
          id: q.id,
          bank,
          unit: q.unit,
          question: q,
          mastery: 0,
          streak: 0,
          attempts: [],
        };
        result.set(q.id, record);
      }
      if (e.op === "answer") {
        const correct = JSON.stringify(e.answer) === JSON.stringify(q.answer);
        // Session+question is the identity of a committed attempt; event id handles pending retries.
        if (
          !record.attempts.some(
            (a) =>
              a.event_id === e.eventId ||
              (a.session_id === id && a.question === q.id),
          )
        )
          record.attempts.push({
            session_id: id,
            question: q.id,
            mode: run.mode,
            snapshot: q,
            answer: e.answer,
            correct,
            answered_at: e.occurredAt,
            received_at: null,
            source: "browser_pending",
            event_id: e.eventId,
            syncStatus: "pending",
          });
        if (!correct) {
          record.mastery = 0;
          record.streak = 0;
          record.masterySource = "wrong_answer";
        }
      } else {
        record.mastery = e.mastery;
        record.masterySource = "manual";
        record.masteryUpdatedAt = e.occurredAt;
      }
    }
  }
  // Preserve answers that arrived after the exam deadline without treating them as scored attempts.
  const rejectedPrefix = `toExcellence.rejected.${uid}.`;
  for (const key of Object.keys(localStorage).filter((k) =>
    k.startsWith(rejectedPrefix),
  )) {
    const id = key.slice(rejectedPrefix.length),
      run = practiceSync(uid, id, api<Run>).cached();
    if (!run || run.bank !== bank) continue;
    for (const e of JSON.parse(localStorage.getItem(key) || "[]") as Entry[]) {
      if (e.op !== "answer" || !ids.includes(e.question)) continue;
      const record = result.get(e.question),
        q = run.items.find((q) => q.id === e.question);
      if (record && q && !record.attempts.some((a) => a.event_id === e.eventId))
        record.attempts.push({
          session_id: id,
          question: q.id,
          mode: run.mode,
          snapshot: q,
          answer: e.answer,
          correct: null,
          answered_at: e.occurredAt,
          received_at: null,
          source: "browser_rejected",
          syncStatus: "rejected",
          counted: false,
          event_id: e.eventId,
        });
    }
  }
  return [...result.values()].sort(
    (a, b) => a.mastery - b.mastery || a.id.localeCompare(b.id),
  );
}
export async function exportMistakes(uid: string, bank: string, ids: string[]) {
  let syncStatus = "synced";
  try {
    await flushAll(uid, api<Run>);
  } catch {
    syncStatus = "includes_pending";
  }
  const cache = `toExcellence.export.v1.${uid}.${bank}`;
  let records: ExportQuestion[];
  try {
    records = await api<ExportQuestion[]>("export", { bank, questions: ids });
    const previous = JSON.parse(
      localStorage.getItem(cache) || "[]",
    ) as ExportQuestion[];
    const combined = new Map(previous.map((r) => [r.id, r]));
    records.forEach((r) => combined.set(r.id, r));
    try {
      localStorage.setItem(cache, JSON.stringify([...combined.values()]));
    } catch {
      /* Download can still succeed. */
    }
  } catch {
    records = (
      JSON.parse(localStorage.getItem(cache) || "[]") as ExportQuestion[]
    ).filter((r) => ids.includes(r.id));
    syncStatus = "cached_partial_history";
  }
  const questions = mergeLocal(records, uid, bank, ids);
  if (ids.some((id) => !questions.some((q) => q.id === id)))
    throw new Error("部分所选题目尚无本地完整记录，请联网后重试导出");
  const output = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    syncStatus,
    description:
      "个人错题记录。答案为选项字母数组；mastery为0未评分、1至3星。answered_at为空表示无法恢复实际答题时间；legacy_snapshot来自历史练习快照。received_at为服务器接收或历史迁移时间，不能作为作答时间。cached_partial_history表示离线缓存，历史可能不完整。snapshot为该次作答使用的题目，question为当前题目。",
    questions,
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(output, null, 2)], {
      type: "application/json;charset=utf-8",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `错题记录-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return syncStatus;
}
