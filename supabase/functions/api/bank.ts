export function validateBank(bank: any) {
  const fail = (field: string): never => {
    throw new Error("题库字段有误：" + field);
  };
  const id = (s: unknown) =>
    typeof s === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(s);
  const text = (s: unknown) => typeof s === "string" && s.trim().length > 0;
  if (bank?.version !== 1 || !id(bank.id) || !text(bank.name))
    fail("version / id / name");
  if (!Array.isArray(bank.units) || !bank.units.length) fail("units");
  const units = new Set(),
    questions = new Set();
  for (const [i, u] of bank.units.entries()) {
    const path = "units[" + i + "]";
    if (!id(u.id) || units.has(u.id)) fail(path + ".id");
    units.add(u.id);
    if (!text(u.name) || !Array.isArray(u.questions) || !u.questions.length)
      fail(path + ".name / questions");
    for (const [j, q] of u.questions.entries()) {
      const at = path + ".questions[" + j + "].";
      if (!id(q.id) || questions.has(q.id)) fail(at + "id");
      questions.add(q.id);
      if (!["judge", "single", "multi"].includes(q.type)) fail(at + "type");
      if (!text(q.stem)) fail(at + "stem");
      if (
        !Array.isArray(q.options) ||
        q.options.length < 2 ||
        q.options.length > 26 ||
        !q.options.every(text) ||
        (q.type === "judge" && q.options.length !== 2)
      )
        fail(at + "options");
      if (
        !Array.isArray(q.answer) ||
        !q.answer.length ||
        new Set(q.answer).size !== q.answer.length ||
        (q.type !== "multi" && q.answer.length !== 1) ||
        !q.answer.every(
          (a: string) =>
            typeof a === "string" &&
            /^[A-Z]$/.test(a) &&
            a.charCodeAt(0) - 65 < q.options.length,
        )
      )
        fail(at + "answer");
      if (q.explanation !== undefined && typeof q.explanation !== "string")
        fail(at + "explanation");
      q.answer.sort();
      u.questions[j] = {
        id: q.id,
        type: q.type,
        stem: q.stem,
        options: q.options,
        answer: q.answer,
        explanation: q.explanation || "",
        supplement: q.supplement === true,
      };
    }
  }
  return bank;
}
