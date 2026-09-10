// Reads the TTU Psychological Sciences labs page and compares it with the LabMatch directory.
import { getStore } from "@netlify/blobs";
import { FACULTY, AREAS, SOURCE_URL } from "../../src/faculty.js";
import { nameKey } from "../../src/shared.js";
import { askClaude, parseJsonArray } from "./claude.mjs";

const clip = (v, n) => String(v ?? "").trim().slice(0, n);

function pageText(html) {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|\/p|\/h\d|\/li|\/div)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n");
  const start = text.indexOf("Psychological Sciences Labs");
  const end = text.indexOf("Box 42051");
  if (start !== -1) text = text.slice(start, end > start ? end : undefined);
  return text.slice(0, 40000);
}

export async function runPageCheck() {
  const res = await fetch(SOURCE_URL, { headers: { "user-agent": "LabMatch student project (weekly directory check)" } });
  if (!res.ok) throw new Error(`The TTU page returned status ${res.status}.`);
  const text = pageText(await res.text());

  const prompt = `Below is the text of the Texas Tech University Department of Psychological Sciences labs page.

List every faculty member on the page. Respond ONLY with a JSON array and nothing else, no markdown or explanation:
[{"name":"Dr. First Last","area":"Clinical","labName":"Lab name, or an empty string","interests":"One-sentence summary of their research interests, under 35 words"}]

Use one of these areas for each person: ${AREAS.join(", ")}. Only include people who appear in the text.

PAGE TEXT:
${text}`;

  const found = parseJsonArray(await askClaude(prompt, 4000)).filter(
    (f) => f && typeof f.name === "string" && nameKey(f.name)
  );
  if (!found.length) throw new Error("No faculty were found on the TTU page.");

  const store = getStore({ name: "labmatch", consistency: "strong" });
  const dir = (await store.get("directory", { type: "json" })) || { raInfo: {}, added: [] };
  const known = new Set([...FACULTY, ...(dir.added || [])].map((f) => nameKey(f.professor)));
  const foundKeys = new Set(found.map((f) => nameKey(f.name)));
  const seen = new Set();

  const newPeople = found
    .filter((f) => {
      const k = nameKey(f.name);
      if (known.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((f) => ({
      name: clip(f.name, 80),
      area: AREAS.includes(f.area) ? f.area : AREAS[0],
      labName: clip(f.labName, 150),
      interests: clip(f.interests, 400),
    }));

  const missing = FACULTY.filter((f) => !foundKeys.has(nameKey(f.professor))).map((f) => f.professor);

  const lastCheck = {
    checkedAt: new Date().toISOString(),
    foundCount: found.length,
    newPeople,
    missing,
    partial: false,
  };
  await store.setJSON("lastCheck", lastCheck);
  return lastCheck;
}
