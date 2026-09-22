// Runs automatically once a day to look for faculty changes on the TTU labs page.
import { runPageCheck } from "../lib/check.mjs";

export default async () => {
  try {
    const r = await runPageCheck();
    console.log(`TTU page checked: ${r.foundCount} faculty found, ${r.newPeople.length} new, ${r.missing.length} missing.`);
  } catch (e) {
    console.error("Weekly TTU page check failed:", e);
  }
};

export const config = { schedule: "@daily" };
