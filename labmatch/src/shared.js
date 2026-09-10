// Constants and helpers used by both the website and the Netlify functions.

export const HIDE_AFTER_REPORTS = 3;
export const MIN_COMMENT = 40;
export const RA_STATUSES = ["open", "ask", "closed", "unknown"];
export const ROLES = ["Undergraduate RA", "Honors or independent study", "Volunteer", "Graduate student", "Other"];
export const TASKS = ["Running participants", "Data entry", "Coding data", "Literature review", "Recruiting",
  "Data analysis", "Writing", "Presenting research", "Lab meetings"];
export const CONTACT_RE = /[\w.+-]+@[\w-]+\.[\w.]+|(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;

// Turns "Dr. Paul B. Ingram" into "ingram|p" so names can be compared loosely.
export function nameKey(name) {
  const cleaned = String(name || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/^\s*dr\.?\s+/i, "")
    .replace(/,?\s*ph\.?\s?d\.?/i, "")
    .toLowerCase().replace(/[^a-z\s-]/g, " ").replace(/\s+/g, " ").trim();
  const parts = cleaned.split(" ").filter((p) => p.length > 1);
  if (!parts.length) return "";
  return `${parts[parts.length - 1]}|${parts[0][0]}`;
}
