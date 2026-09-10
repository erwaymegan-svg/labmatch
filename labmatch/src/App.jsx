import { useState, useEffect, useMemo } from "react";
import { FACULTY, AREAS, SOURCE_URL, BASE_COPIED } from "./faculty.js";
import { nameKey, ROLES, TASKS, HIDE_AFTER_REPORTS, CONTACT_RE, MIN_COMMENT } from "./shared.js";
import { api, ADMIN_KEY } from "./api.js";

const CONTACT_EMAIL = import.meta.env.VITE_CONTACT_EMAIL || "";
const MINE_KEY = "labmatch-mine";

const SUGGESTIONS = ["anxiety", "suicide prevention", "sleep", "memory", "addiction", "child health", "social media", "virtual reality", "stigma", "emotion"];

const STATUS = {
  open: "Taking RAs",
  ask: "Ask about RA openings",
  closed: "Not taking RAs",
  unknown: "RA openings not confirmed",
};
const STATUS_ORDER = { open: 0, ask: 1, unknown: 2, closed: 3 };

const EMPTY_RA = { status: "unknown", term: "", commitment: "", compensation: "", requirements: "", howToApply: "", updated: "" };
const EMPTY_NEW = { professor: "", area: AREAS[0], labName: "", labUrl: "", email: "", interests: "", tags: "" };
const EMPTY_STORE = { raInfo: {}, added: [], lastCheck: null };

const RATING_WORDS = { 1: "Poor", 2: "Below average", 3: "Okay", 4: "Good", 5: "Excellent" };

function summarize(list) {
  const visible = list.filter((r) => !r.hidden && (r.reports || 0) < HIDE_AFTER_REPORTS);
  const n = visible.length;
  if (!n) return { count: 0, hidden: list.length };
  const sum = (k) => visible.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const taskCounts = {};
  visible.forEach((r) => (r.tasks || []).forEach((t) => (taskCounts[t] = (taskCounts[t] || 0) + 1)));
  return {
    count: n,
    hidden: list.length - n,
    overall: sum("overall") / n,
    mentorship: sum("mentorship") / n,
    recommend: visible.filter((r) => r.recommend).length,
    topTasks: Object.entries(taskCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t),
  };
}

const STOP = new Set(["and", "the", "for", "with", "about", "how", "why", "what", "are", "people", "interested",
  "really", "things", "stuff", "like", "want", "study", "research", "psychology", "that", "some", "more", "than",
  "others", "affects", "into", "their", "they"]);

function tokens(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
}

function keywordMatch(text, pool) {
  const want = [...new Set(tokens(text))];
  if (!want.length) return [];
  return pool
    .map((lab) => {
      const hay = tokens([lab.labName, lab.area, lab.tags.join(" "), lab.interests].join(" "));
      const hits = want.filter((w) => hay.some((h) => h.slice(0, 5) === w.slice(0, 5)));
      return {
        lab,
        score: Math.round((100 * hits.length) / want.length),
        reason: hits.length ? `Shares your interest in ${hits.slice(0, 3).join(", ")}.` : "",
      };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);
}


function formatDay(str) {
  const d = new Date(str.length === 10 ? str + "T00:00:00" : str);
  if (isNaN(d)) return "an unknown date";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function monthsSince(str) {
  const d = new Date(str + "T00:00:00");
  return isNaN(d) ? 0 : (Date.now() - d.getTime()) / (30.44 * 86400000);
}

function Field({ id, label, hint, children }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <span className="hint">{hint}</span>}
      {children}
    </div>
  );
}

function Stars({ value }) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <span className="stars" role="img" aria-label={`${value.toFixed(1)} out of 5 stars`}>
      <span className="stars-bg" aria-hidden="true">★★★★★</span>
      <span className="stars-fg" aria-hidden="true" style={{ width: `${pct}%` }}>★★★★★</span>
    </span>
  );
}

function StarInput({ name, label, hint, value, onChange }) {
  return (
    <fieldset className="star-input">
      <legend>{label}</legend>
      {hint && <span className="hint">{hint}</span>}
      <div className="star-row">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={n <= value ? "star on" : "star"}>
            <input type="radio" name={name} value={n} checked={value === n} onChange={() => onChange(n)} className="sr" />
            <span aria-hidden="true">★</span>
            <span className="sr">{n} out of 5, {RATING_WORDS[n]}</span>
          </label>
        ))}
        <span className="star-caption">{value ? RATING_WORDS[value] : "Choose a rating"}</span>
      </div>
    </fieldset>
  );
}

const EMPTY_REVIEW = { overall: 0, mentorship: 0, recommend: null, role: ROLES[0], term: "", project: "", tasks: [],
  hours: "", comment: "", name: "", agree: false };

function ReviewForm({ labId, labLabel, onSubmit, onCancel }) {
  const [f, setF] = useState(EMPTY_REVIEW);
  const [error, setError] = useState("");
  const [posting, setPosting] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const toggleTask = (t) => set("tasks", f.tasks.includes(t) ? f.tasks.filter((x) => x !== t) : [...f.tasks, t]);

  async function submit() {
    const problems = [];
    if (!f.overall) problems.push("rate your overall experience");
    if (!f.mentorship) problems.push("rate the mentorship");
    if (f.recommend === null) problems.push("say whether you'd recommend the lab");
    if (!f.project.trim()) problems.push("describe the project you worked on");
    if (f.comment.trim().length < MIN_COMMENT) problems.push(`write at least ${MIN_COMMENT} characters about your experience`);
    if (!f.agree) problems.push("confirm the review guidelines");
    if (problems.length) {
      setError(`To post your review, ${problems.join(", ")}.`);
      return;
    }
    if (CONTACT_RE.test(`${f.project} ${f.comment} ${f.name}`)) {
      setError("Remove email addresses and phone numbers from your review before posting.");
      return;
    }
    setError("");
    setPosting(true);
    const err = await onSubmit({
      id: `rev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      overall: f.overall,
      mentorship: f.mentorship,
      recommend: f.recommend,
      role: f.role,
      term: f.term.trim(),
      project: f.project.trim(),
      tasks: f.tasks,
      hours: f.hours.trim(),
      comment: f.comment.trim(),
      name: f.name.trim(),
      createdAt: new Date().toISOString(),
      reports: 0,
    });
    setPosting(false);
    if (!err) setF(EMPTY_REVIEW);
    else setError(err);
  }

  return (
    <div className="review-form">
      <p className="form-title">Review {labLabel}</p>
      <p className="lm-muted small">
        Share what it was really like to work here so other students can decide if it's a good fit.
      </p>

      <div className="grid2 top">
        <StarInput name={`${labId}-overall`} label="Overall experience" value={f.overall} onChange={(n) => set("overall", n)} />
        <StarInput name={`${labId}-mentor`} label="Mentorship" hint="Support from the professor or grad students"
          value={f.mentorship} onChange={(n) => set("mentorship", n)} />
      </div>

      <fieldset className="plain">
        <legend>Would you recommend this lab to other students?</legend>
        <div className="radios">
          {[[true, "Yes"], [false, "No"]].map(([v, label]) => (
            <label key={label} className={f.recommend === v ? "radio sel" : "radio"}>
              <input type="radio" name={`${labId}-rec`} checked={f.recommend === v} onChange={() => set("recommend", v)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <Field id={`${labId}-project`} label="Project you worked on" hint="For example: a study on sleep and test anxiety in first-year students">
        <input id={`${labId}-project`} value={f.project} onChange={(e) => set("project", e.target.value)} />
      </Field>

      <fieldset className="plain">
        <legend>What you did (optional)</legend>
        <div className="chips">
          {TASKS.map((t) => (
            <button key={t} type="button" className={f.tasks.includes(t) ? "chip sel" : "chip"}
              aria-pressed={f.tasks.includes(t)} onClick={() => toggleTask(t)}>
              {t}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid3">
        <Field id={`${labId}-role`} label="Your role">
          <select id={`${labId}-role`} value={f.role} onChange={(e) => set("role", e.target.value)}>
            {ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <Field id={`${labId}-term`} label="When (optional)">
          <input id={`${labId}-term`} placeholder="Fall 2025" value={f.term} onChange={(e) => set("term", e.target.value)} />
        </Field>
        <Field id={`${labId}-hours`} label="Hours per week (optional)">
          <input id={`${labId}-hours`} placeholder="8" value={f.hours} onChange={(e) => set("hours", e.target.value)} />
        </Field>
      </div>

      <Field id={`${labId}-comment`} label="Your experience"
        hint="What was the lab like? What did you learn? How was working with the professor or grad students?">
        <textarea id={`${labId}-comment`} rows={5} value={f.comment} onChange={(e) => set("comment", e.target.value)} />
        <span className={f.comment.trim().length >= MIN_COMMENT ? "counter ok" : "counter"}>
          {f.comment.trim().length < MIN_COMMENT
            ? `${MIN_COMMENT - f.comment.trim().length} more characters needed`
            : "Looks good"}
        </span>
      </Field>

      <Field id={`${labId}-name`} label="Display name (optional)" hint="Leave blank to post as an anonymous former lab member">
        <input id={`${labId}-name`} value={f.name} onChange={(e) => set("name", e.target.value)} />
      </Field>

      <label className="agree">
        <input type="checkbox" checked={f.agree} onChange={(e) => set("agree", e.target.checked)} />
        <span>
          I worked or volunteered in this lab. My review describes my own experience, doesn't name other students, and
          doesn't include personal attacks or private information.
        </span>
      </label>

      {error && <p className="lm-error" role="alert">{error}</p>}
      <div className="actions">
        <button className="primary" onClick={submit} disabled={posting}>{posting ? "Posting…" : "Post review"}</button>
        {onCancel && <button className="secondary" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

function ReviewsPanel({ lab, reviews, summary, mine, onSubmit, onReport, onDelete, onRestore }) {
  const [showForm, setShowForm] = useState(reviews.length === 0);
  const [posted, setPosted] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const sorted = [...reviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const visible = sorted.filter((r) => !r.hidden && (mine.admin || (r.reports || 0) < HIDE_AFTER_REPORTS));
  const labLabel = lab.labName && lab.labName !== "Lab coming soon" ? lab.labName : `${lab.professor}'s lab`;

  async function handleSubmit(review) {
    const err = await onSubmit(review);
    if (!err) {
      setShowForm(false);
      setPosted(true);
    }
    return err;
  }

  return (
    <section className="reviews" aria-label={`Reviews of ${labLabel}`}>
      {summary.count > 0 && (
        <div className="review-summary">
          <div>
            <span className="big">{summary.overall.toFixed(1)}</span>
            <Stars value={summary.overall} />
            <span className="lm-muted small-block">Overall experience</span>
          </div>
          <div>
            <span className="big">{summary.mentorship.toFixed(1)}</span>
            <Stars value={summary.mentorship} />
            <span className="lm-muted small-block">Mentorship</span>
          </div>
          <div>
            <span className="big">{Math.round((100 * summary.recommend) / summary.count)}%</span>
            <span className="lm-muted small-block">would recommend</span>
          </div>
          {summary.topTasks.length > 0 && (
            <p className="common">Common tasks: {summary.topTasks.join(", ").toLowerCase()}</p>
          )}
        </div>
      )}

      {posted && <p className="lm-ok">Review posted. Thanks for helping other students.</p>}

      {showForm ? (
        <ReviewForm labId={lab.id} labLabel={labLabel} onSubmit={handleSubmit}
          onCancel={reviews.length ? () => setShowForm(false) : null} />
      ) : (
        <button className="secondary" onClick={() => { setShowForm(true); setPosted(false); }}>
          Write a review
        </button>
      )}

      {visible.length > 0 && (
        <ul className="review-list">
          {visible.map((r) => {
            const isMine = Boolean(mine.tokens[r.id]);
            const reported = mine.reported.includes(r.id);
            return (
              <li key={r.id} className="review">
                <div className="review-top">
                  <Stars value={r.overall} />
                  <span className={r.recommend ? "rec yes" : "rec no"}>
                    {r.recommend ? "Would recommend" : "Wouldn't recommend"}
                  </span>
                  <span className="lm-muted">Mentorship {r.mentorship} of 5</span>
                </div>
                <p className="project">{r.project}</p>
                <p className="review-meta">
                  {[r.role, r.term, r.hours && `${r.hours} hrs/week`].filter(Boolean).join(", ")}
                </p>
                {r.tasks && r.tasks.length > 0 && (
                  <div className="tags">{r.tasks.map((t) => <span key={t} className="tag plain">{t}</span>)}</div>
                )}
                <p className="comment">{r.comment}</p>
                <div className="review-foot">
                  <span className="lm-muted">
                    {r.name || "Anonymous former lab member"}, {formatDay(r.createdAt)}
                    {isMine && " (your review)"}
                  </span>
                  <span className="foot-actions">
                    {(isMine || mine.admin) && (
                      <button className="link" onClick={() => {
                        if (confirmId === r.id) { onDelete(r.id); setConfirmId(null); } else setConfirmId(r.id);
                      }}>
                        {confirmId === r.id ? "Confirm delete" : isMine ? "Delete my review" : "Remove review"}
                      </button>
                    )}
                    {mine.admin && (r.reports || 0) > 0 && (
                      <button className="link" onClick={() => onRestore(r.id)}>Clear reports</button>
                    )}
                    {!isMine && !mine.admin && (reported ? (
                      <span className="lm-muted">Reported</span>
                    ) : (
                      <button className="link muted-link" onClick={() => onReport(r.id)}>Report</button>
                    ))}
                  </span>
                </div>
                {mine.admin && (r.reports || 0) > 0 && (
                  <p className="lm-error">
                    {r.reports} report{r.reports === 1 ? "" : "s"}.
                    {r.reports >= HIDE_AFTER_REPORTS && " Hidden from students until you clear the reports or remove it."}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {summary.hidden > 0 && (
        <p className="lm-muted small">
          {summary.hidden} review{summary.hidden === 1 ? " is" : "s are"} hidden after being reported by multiple users.
        </p>
      )}
    </section>
  );
}

function LabRow({ item, panel, onTogglePanel, reviews, mine, onSubmitReview, onReport, onDelete, onRestore }) {
  const { lab, score, reason } = item;
  const open = panel === "details";
  const reviewsOpen = panel === "reviews";
  const s = summarize(reviews);
  const ra = lab.ra;
  const statusText = (ra.status === "open" || ra.status === "closed") && ra.term
    ? `${STATUS[ra.status]} for ${ra.term}` : STATUS[ra.status] || STATUS.unknown;
  const raRows = [
    ["Time commitment", ra.commitment],
    ["Pay or credit", ra.compensation],
    ["Requirements", ra.requirements],
    ["How to apply", ra.howToApply],
  ].filter(([, v]) => v && v.trim());
  const stale = ra.updated && monthsSince(ra.updated) > 6;

  return (
    <li className="lm-row">
      <div className="row-head">
        <span className={`badge ${ra.status}`}>{statusText}</span>
        <span className="area">{lab.area}</span>
        {lab.added && <span className="sample">Added in LabMatch</span>}
      </div>
      <h3>{lab.professor}</h3>
      {lab.labName && (
        <p className="labname">
          {lab.labUrl ? <a href={lab.labUrl} target="_blank" rel="noopener noreferrer">{lab.labName}</a> : lab.labName}
        </p>
      )}
      {s.count > 0 && (
        <p className="rating-line">
          <Stars value={s.overall} />
          <strong>{s.overall.toFixed(1)}</strong>
          <span className="lm-muted">
            from {s.count} review{s.count === 1 ? "" : "s"}. {s.recommend} of {s.count} would recommend it.
          </span>
        </p>
      )}

      {typeof score === "number" && (
        <div className="match">
          <div className="bar" aria-hidden="true"><span style={{ width: `${score}%` }} /></div>
          <span className="pct">{score}% match</span>
        </div>
      )}
      {reason && <p className="reason">{reason}</p>}

      <p className="desc">{lab.interests}</p>
      <div className="tags">{lab.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>

      <div className="row-actions">
        <button className="link" aria-expanded={open} onClick={() => onTogglePanel("details")}>
          {open ? "Hide RA and contact details" : "Show RA and contact details"}
        </button>
        <button className="link" aria-expanded={reviewsOpen} onClick={() => onTogglePanel("reviews")}>
          {reviewsOpen ? "Hide reviews" : s.count > 0 ? `Read reviews (${s.count})` : "Write the first review"}
        </button>
      </div>

      {open && (
        <dl className="details">
          {ra.status === "unknown" && raRows.length === 0 && (
            <p className="note-inline">
              No one has confirmed RA openings for this lab yet, and the TTU labs page doesn't list them. Email the
              professor or check the lab website to ask.
            </p>
          )}
          {raRows.map(([k, v]) => (
            <div className="drow" key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
          {lab.email && (
            <div className="drow"><dt>Email</dt><dd><a href={`mailto:${lab.email}`}>{lab.email}</a></dd></div>
          )}
          {lab.labUrl && (
            <div className="drow"><dt>Lab website</dt>
              <dd><a href={lab.labUrl} target="_blank" rel="noopener noreferrer">{lab.labUrl.replace(/^https?:\/\//, "")}</a></dd>
            </div>
          )}
          {lab.profileUrl && (
            <div className="drow"><dt>Faculty profile</dt>
              <dd><a href={lab.profileUrl} target="_blank" rel="noopener noreferrer">View profile on the TTU site</a></dd>
            </div>
          )}
          {ra.updated && (
            <p className={stale ? "updated stale" : "updated"}>
              RA details updated {formatDay(ra.updated)}.
              {stale && " This may be out of date, so confirm with the lab before applying."}
            </p>
          )}
        </dl>
      )}

      {reviewsOpen && (
        <ReviewsPanel
          lab={lab}
          reviews={reviews}
          summary={s}
          mine={mine}
          onSubmit={(review) => onSubmitReview(lab.id, review)}
          onReport={(id) => onReport(lab.id, id)}
          onDelete={(id) => onDelete(lab.id, id)}
          onRestore={(id) => onRestore(lab.id, id)}
        />
      )}
    </li>
  );
}

function loadMine() {
  try {
    const v = JSON.parse(localStorage.getItem(MINE_KEY) || "{}");
    return { tokens: v.tokens || {}, reported: v.reported || [], admin: false };
  } catch (e) {
    return { tokens: {}, reported: [], admin: false };
  }
}

function saveMine(m) {
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify({ tokens: m.tokens, reported: m.reported }));
  } catch (e) {
    // Private browsing can block storage; your own reviews just won't be remembered.
  }
}

function hasAdminToken() {
  try {
    return Boolean(localStorage.getItem(ADMIN_KEY));
  } catch (e) {
    return false;
  }
}

export default function LabMatch() {
  const [store, setStore] = useState(EMPTY_STORE);
  const [loading, setLoading] = useState(true);
  const [storageError, setStorageError] = useState("");
  const [view, setView] = useState("find");

  const [interests, setInterests] = useState("");
  const [openOnly, setOpenOnly] = useState(false);
  const [results, setResults] = useState(null);
  const [matching, setMatching] = useState(false);
  const [matchMode, setMatchMode] = useState("");
  const [matchError, setMatchError] = useState("");
  const [expanded, setExpanded] = useState(null);

  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");

  const [editingId, setEditingId] = useState("");
  const [raForm, setRaForm] = useState(EMPTY_RA);
  const [newForm, setNewForm] = useState(EMPTY_NEW);
  const [saveMsg, setSaveMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [reviews, setReviews] = useState({});
  const [mine, setMine] = useState(loadMine);
  const [sortBy, setSortBy] = useState("status");

  useEffect(() => {
    // Visiting /?admin=YOUR_ADMIN_TOKEN once saves the admin token on this device.
    const params = new URLSearchParams(window.location.search);
    if (params.has("admin")) {
      const token = params.get("admin");
      try {
        if (token) localStorage.setItem(ADMIN_KEY, token);
        else localStorage.removeItem(ADMIN_KEY);
      } catch (e) {
        // Ignore storage errors.
      }
      params.delete("admin");
      const q = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (q ? `?${q}` : ""));
    }
    loadState();
  }, []);

  async function loadState() {
    setLoading(true);
    try {
      const [state, admin] = await Promise.all([
        api("state"),
        hasAdminToken() ? api("admin").catch(() => ({ admin: false })) : Promise.resolve({ admin: false }),
      ]);
      setStore({ ...EMPTY_STORE, ...state.store });
      setReviews(state.reviews || {});
      setMine((m) => ({ ...m, admin: Boolean(admin.admin) }));
      setStorageError("");
    } catch (e) {
      setStorageError("Saved RA details and reviews couldn't load. Refresh the page to try again.");
    }
    setLoading(false);
  }

  const labs = useMemo(
    () =>
      [...FACULTY, ...store.added].map((f) => ({
        ...f,
        ra: { ...EMPTY_RA, ...(store.raInfo[f.id] || {}) },
      })),
    [store]
  );

  function updateMine(fn) {
    setMine((m) => {
      const next = fn(m);
      saveMine(next);
      return next;
    });
  }

  function applyDirectory(dir) {
    setStore((s) => ({ ...s, raInfo: dir.raInfo || {}, added: dir.added || [] }));
    setResults(null);
  }

  function addInterest(s) {
    setInterests((prev) => {
      if (prev.toLowerCase().includes(s)) return prev;
      const trimmed = prev.trim().replace(/[,.]$/, "");
      return trimmed ? `${trimmed}, ${s}` : s;
    });
  }

  async function findMatches() {
    const text = interests.trim();
    if (!text) {
      setMatchError("Add at least one interest to find matching labs.");
      return;
    }
    setMatchError("");
    setMatching(true);
    setExpanded(null);
    const byId = Object.fromEntries(labs.map((l) => [l.id, l]));
    try {
      const data = await api("match", { method: "POST", body: { interests: text } });
      setResults(
        data.results.filter((m) => byId[m.id]).map((m) => ({ lab: byId[m.id], score: m.score, reason: m.reason }))
      );
      setMatchMode("ai");
    } catch (e) {
      setResults(keywordMatch(text, labs));
      setMatchMode("keyword");
    }
    setMatching(false);
  }

  async function runCheck() {
    setChecking(true);
    setCheckError("");
    try {
      const data = await api("check", { method: "POST", body: {} });
      setStore((s) => ({ ...s, lastCheck: data.lastCheck }));
    } catch (e) {
      setCheckError("The TTU page couldn't be checked right now. Try again in a few minutes, or open the page to check it yourself.");
    }
    setChecking(false);
  }

  function pick(id) {
    setEditingId(id);
    setSaveMsg(null);
    setConfirmDelete(false);
    if (id === "__new") setNewForm(EMPTY_NEW);
    else setRaForm({ ...EMPTY_RA, ...(store.raInfo[id] || {}) });
  }

  function addFromCheck(person) {
    setView("manage");
    setEditingId("__new");
    setNewForm({
      ...EMPTY_NEW,
      professor: person.name,
      area: person.area,
      labName: person.labName || "",
      interests: person.interests || "",
    });
    setSaveMsg(null);
  }

  const updRa = (k) => (e) => setRaForm((f) => ({ ...f, [k]: e.target.value }));
  const updNew = (k) => (e) => setNewForm((f) => ({ ...f, [k]: e.target.value }));

  async function saveRA() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const data = await api("ra", { method: "POST", body: { id: editingId, entry: raForm } });
      applyDirectory(data.store);
      setRaForm(data.entry);
      setSaveMsg({ type: "ok", text: "RA details saved." });
    } catch (e) {
      setSaveMsg({ type: "error", text: e.message });
    }
    setSaving(false);
  }

  async function clearRA() {
    try {
      const data = await api("ra", { method: "DELETE", body: { id: editingId } });
      applyDirectory(data.store);
      setRaForm(EMPTY_RA);
      setSaveMsg({ type: "ok", text: "RA details cleared." });
    } catch (e) {
      setSaveMsg({ type: "error", text: e.message });
    }
  }

  async function saveNew() {
    const missingFields = [];
    if (!newForm.professor.trim()) missingFields.push("name");
    if (!newForm.interests.trim()) missingFields.push("research interests");
    if (missingFields.length) {
      setSaveMsg({ type: "error", text: `Add the ${missingFields.join(" and ")} before adding this person.` });
      return;
    }
    setSaving(true);
    try {
      const data = await api("faculty", { method: "POST", body: { person: newForm } });
      applyDirectory(data.store);
      setEditingId(data.person.id);
      setRaForm(EMPTY_RA);
      setSaveMsg({ type: "ok", text: `Added ${data.person.professor} to the directory. Add RA details below if you have them.` });
    } catch (e) {
      setSaveMsg({ type: "error", text: e.message });
    }
    setSaving(false);
  }

  async function removeAdded() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setConfirmDelete(false);
    try {
      const data = await api("faculty", { method: "DELETE", body: { id: editingId } });
      applyDirectory(data.store);
      setEditingId("");
      setSaveMsg({ type: "ok", text: "Removed from the directory." });
    } catch (e) {
      setSaveMsg({ type: "error", text: e.message });
    }
  }

  async function submitReview(labId, review) {
    try {
      const data = await api("reviews", { method: "POST", body: { labId, review } });
      setReviews(data.reviews);
      updateMine((m) => ({ ...m, tokens: { ...m.tokens, [data.reviewId]: data.token } }));
      return null;
    } catch (e) {
      return e.message;
    }
  }

  async function reportReview(labId, reviewId) {
    if (mine.reported.includes(reviewId)) return;
    try {
      const data = await api("reviews/report", { method: "POST", body: { labId, reviewId } });
      setReviews(data.reviews);
      updateMine((m) => ({ ...m, reported: [...m.reported, reviewId] }));
    } catch (e) {
      setStorageError(e.message);
    }
  }

  async function deleteReview(labId, reviewId) {
    try {
      const data = await api("reviews", { method: "DELETE", body: { labId, reviewId, token: mine.tokens[reviewId] } });
      setReviews(data.reviews);
      updateMine((m) => {
        const tokens = { ...m.tokens };
        delete tokens[reviewId];
        return { ...m, tokens };
      });
    } catch (e) {
      setStorageError(e.message);
    }
  }

  async function restoreReview(labId, reviewId) {
    try {
      const data = await api("reviews/restore", { method: "POST", body: { labId, reviewId } });
      setReviews(data.reviews);
    } catch (e) {
      setStorageError(e.message);
    }
  }

  const summaries = Object.fromEntries(labs.map((l) => [l.id, summarize(reviews[l.id] || [])]));
  const sorters = {
    status: (a, b) => STATUS_ORDER[a.ra.status] - STATUS_ORDER[b.ra.status],
    rating: (a, b) => (summaries[b.id].overall || 0) - (summaries[a.id].overall || 0),
    reviews: (a, b) => summaries[b.id].count - summaries[a.id].count,
    name: () => 0,
  };
  const base = results
    ? results
    : [...labs]
        .sort((a, b) => sorters[sortBy](a, b) || a.professor.localeCompare(b.professor))
        .map((lab) => ({ lab }));
  const shown = openOnly ? base.filter((i) => i.lab.ra.status === "open") : base;
  const confirmedCount = labs.filter((l) => l.ra.status === "open").length;

  let emptyText = "No faculty are listed yet.";
  if (openOnly && base.length)
    emptyText = "No labs have confirmed RA openings yet. Turn off the filter to see everyone, then email the professors whose research interests you.";
  else if (results) emptyText = "No labs matched those interests. Try broader topics, like emotion, health, or memory.";

  const lc = store.lastCheck;
  const knownKeys = new Set(labs.map((l) => nameKey(l.professor)));
  const pendingNew = lc ? lc.newPeople.filter((p) => !knownKeys.has(nameKey(p.name))) : [];
  const current = labs.find((l) => l.id === editingId);

  return (
    <div className="lm">
      <style>{css}</style>
      <div className="lm-wrap">
        <header className="lm-top">
          <span className="lm-brand">LabMatch <span className="brand-sub">TTU Psychological Sciences</span></span>
          <nav className="lm-nav" aria-label="Sections">
            <button className={view === "find" ? "on" : ""} onClick={() => setView("find")}>Find a lab</button>
            <button className={view === "manage" ? "on" : ""} onClick={() => setView("manage")}>Update RA openings</button>
          </nav>
        </header>

        {storageError && <p className="lm-error" role="alert">{storageError}</p>}

        {loading ? (
          <p className="lm-muted">Loading the lab directory…</p>
        ) : view === "find" ? (
          <main>
            <section className="lm-hero">
              <label htmlFor="interests" className="lm-prompt">What do you want to study in psychology?</label>
              <textarea
                id="interests"
                rows={3}
                value={interests}
                onChange={(e) => setInterests(e.target.value)}
                placeholder="For example: why some people worry more than others, and how sleep affects mood"
              />
              <div className="chips">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="chip" onClick={() => addInterest(s)}>{s}</button>
                ))}
              </div>
              <div className="actions">
                <button className="primary" onClick={findMatches} disabled={matching}>
                  {matching ? "Finding labs…" : "Find matching labs"}
                </button>
                <label className="toggle">
                  <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
                  Only labs taking RAs ({confirmedCount})
                </label>
              </div>
              {matchError && <p className="lm-error" role="alert">{matchError}</p>}
            </section>

            <section className="dirbar" aria-live="polite">
              <div className="dirbar-top">
                <p>
                  {FACULTY.length} faculty from the{" "}
                  <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">TTU Psychological Sciences labs page</a>
                  {store.added.length > 0 && `, plus ${store.added.length} added in LabMatch`}.{" "}
                  {lc ? `Last checked ${formatDay(lc.checkedAt)}.` : `Copied ${formatDay(BASE_COPIED)}.`} The page is checked automatically every week.
                </p>
                <button className="secondary" onClick={runCheck} disabled={checking}>
                  {checking ? "Checking the page…" : "Check page for changes"}
                </button>
              </div>
              {checkError && <p className="lm-error">{checkError}</p>}
              {lc && !checking && (
                <div className="check">
                  {pendingNew.length > 0 && (
                    <div>
                      <p className="check-head">Possibly new on the page</p>
                      <ul className="newlist">
                        {pendingNew.map((p) => (
                          <li key={p.name}>
                            <span>{p.name} <span className="lm-muted">({p.area})</span></span>
                            <button className="link" onClick={() => addFromCheck(p)}>Add to directory</button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {lc.missing.length > 0 && (
                    <p>
                      <span className="check-head">Not found in the latest check: </span>
                      {lc.missing.join(", ")}. They may have left, or the check may have missed them, so open the page to confirm.
                    </p>
                  )}
                  {lc.partial && (
                    <p className="lm-muted">
                      The check only found {lc.foundCount} of {FACULTY.length} faculty, so it may have missed part of the page.
                    </p>
                  )}
                  {pendingNew.length === 0 && lc.missing.length === 0 && !lc.partial && (
                    <p className="lm-muted">No changes found. The check matched {lc.foundCount} faculty on the page.</p>
                  )}
                </div>
              )}
            </section>

            <section aria-live="polite">
              <div className="listhead">
                <h2>{results ? `${shown.length} matching lab${shown.length === 1 ? "" : "s"}` : `All faculty (${shown.length})`}</h2>
                {results ? (
                  <button className="link" onClick={() => setResults(null)}>Show all faculty</button>
                ) : (
                  <label className="sort">
                    Sort by
                    <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                      <option value="status">RA openings</option>
                      <option value="rating">Highest rated</option>
                      <option value="reviews">Most reviewed</option>
                      <option value="name">Name</option>
                    </select>
                  </label>
                )}
              </div>
              {results && matchMode === "keyword" && (
                <p className="lm-muted small">AI matching isn't available right now, so these are matched by shared keywords.</p>
              )}
              {shown.length === 0 ? (
                <p className="lm-empty">{emptyText}</p>
              ) : (
                <ul className="lm-list">
                  {shown.map((item) => (
                    <LabRow
                      key={item.lab.id}
                      item={item}
                      panel={expanded && expanded.id === item.lab.id ? expanded.panel : null}
                      onTogglePanel={(p) =>
                        setExpanded(expanded && expanded.id === item.lab.id && expanded.panel === p
                          ? null : { id: item.lab.id, panel: p })
                      }
                      reviews={reviews[item.lab.id] || []}
                      mine={mine}
                      onSubmitReview={submitReview}
                      onReport={reportReview}
                      onRestore={restoreReview}
                      onDelete={deleteReview}
                    />
                  ))}
                </ul>
              )}
            </section>
          </main>
        ) : (
          <main className="manage">
            <h1 className="lm-title">Update RA openings</h1>
            <p className="lm-muted intro">
              The TTU labs page doesn't list research assistant openings, so that information is added here by
              professors, lab members, or students who've confirmed it. Anything you save is shared with everyone
              using LabMatch.
            </p>

            <Field id="pick" label="Faculty member">
              <select id="pick" value={editingId} onChange={(e) => pick(e.target.value)}>
                <option value="">Choose a faculty member</option>
                {AREAS.map((area) => (
                  <optgroup key={area} label={area}>
                    {labs
                      .filter((l) => l.area === area)
                      .sort((a, b) => a.professor.localeCompare(b.professor))
                      .map((l) => <option key={l.id} value={l.id}>{l.professor}</option>)}
                  </optgroup>
                ))}
                <option value="__new">Add someone not on the list</option>
              </select>
            </Field>

            {editingId === "__new" && (
              <section className="panel">
                <p className="lm-muted small">
                  Use this for faculty who joined after the directory was copied, like people flagged by a page check.
                </p>
                <div className="grid2">
                  <Field id="n-name" label="Name">
                    <input id="n-name" value={newForm.professor} onChange={updNew("professor")} placeholder="Dr. First Last" />
                  </Field>
                  <Field id="n-area" label="Area">
                    <select id="n-area" value={newForm.area} onChange={updNew("area")}>
                      {AREAS.map((a) => <option key={a}>{a}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="grid2">
                  <Field id="n-lab" label="Lab name (optional)">
                    <input id="n-lab" value={newForm.labName} onChange={updNew("labName")} />
                  </Field>
                  <Field id="n-url" label="Lab website (optional)">
                    <input id="n-url" type="url" placeholder="https://" value={newForm.labUrl} onChange={updNew("labUrl")} />
                  </Field>
                </div>
                <Field id="n-email" label="Email (optional)">
                  <input id="n-email" type="email" value={newForm.email} onChange={updNew("email")} />
                </Field>
                <Field id="n-int" label="Research interests" hint="Copy or summarize from the TTU labs page">
                  <textarea id="n-int" rows={3} value={newForm.interests} onChange={updNew("interests")} />
                </Field>
                <Field id="n-tags" label="Topics (optional)" hint="Separate with commas, like: memory, aging">
                  <input id="n-tags" value={newForm.tags} onChange={updNew("tags")} />
                </Field>
                <div className="actions">
                  <button className="primary" onClick={saveNew} disabled={saving}>
                    {saving ? "Adding…" : "Add to directory"}
                  </button>
                </div>
              </section>
            )}

            {current && (
              <section className="panel">
                <div className="summary">
                  <p className="summary-name">{current.professor}</p>
                  {current.labName && <p className="labname">{current.labName}</p>}
                  <p className="lm-muted small">{current.interests}</p>
                </div>

                <fieldset>
                  <legend>Research assistant openings</legend>
                  <div className="radios">
                    {["open", "ask", "closed", "unknown"].map((key) => (
                      <label key={key} className={raForm.status === key ? "radio sel" : "radio"}>
                        <input type="radio" name="status" value={key} checked={raForm.status === key} onChange={updRa("status")} />
                        {key === "unknown" ? "Not confirmed" : STATUS[key]}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="grid2">
                  <Field id="term" label="For which term" hint="For example: 2026–27 or Spring 2027">
                    <input id="term" value={raForm.term} onChange={updRa("term")} />
                  </Field>
                  <Field id="commitment" label="Time commitment" hint="For example: 6 to 10 hours per week">
                    <input id="commitment" value={raForm.commitment} onChange={updRa("commitment")} />
                  </Field>
                </div>
                <div className="grid2">
                  <Field id="compensation" label="Pay or credit">
                    <input id="compensation" value={raForm.compensation} onChange={updRa("compensation")} />
                  </Field>
                  <Field id="requirements" label="Requirements">
                    <input id="requirements" value={raForm.requirements} onChange={updRa("requirements")} />
                  </Field>
                </div>
                <Field id="howToApply" label="How to apply">
                  <textarea id="howToApply" rows={2} value={raForm.howToApply} onChange={updRa("howToApply")} />
                </Field>

                <div className="actions">
                  <button className="primary" onClick={saveRA} disabled={saving}>
                    {saving ? "Saving…" : "Save RA details"}
                  </button>
                  {store.raInfo[editingId] && (
                    <button className="secondary" onClick={clearRA}>Clear RA details</button>
                  )}
                  {current.added && mine.admin && (
                    <button className="danger" onClick={removeAdded}>
                      {confirmDelete ? "Confirm removal" : "Remove from directory"}
                    </button>
                  )}
                </div>
              </section>
            )}

            {saveMsg && (
              <p className={saveMsg.type === "ok" ? "lm-ok" : "lm-error"} role="status">{saveMsg.text}</p>
            )}
          </main>
        )}

        <footer className="site-foot">
          <p>
            LabMatch is a student-made project and isn't affiliated with or endorsed by Texas Tech University. Faculty
            information comes from the public{" "}
            <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">Psychological Sciences labs page</a>.
          </p>
          {CONTACT_EMAIL && (
            <p>
              Professors and lab members can request a correction or removal by emailing{" "}
              <a href={`mailto:${CONTACT_EMAIL}?subject=LabMatch%20correction`}>{CONTACT_EMAIL}</a>.
            </p>
          )}
          {mine.admin && <p className="admin-note">You're signed in as the site admin on this device.</p>}
        </footer>
      </div>
    </div>
  );
}

const css = `
@import url('https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,600&family=Public+Sans:wght@400;500;600&display=swap');

.lm {
  --ink: #1E2F3C; --paper: #F3F6F7; --line: #D5DEE2; --muted: #56666F;
  --accent: #3E5BA9; --accent-dk: #2F4687;
  min-height: 100vh; background: var(--paper); color: var(--ink);
  font-family: "Public Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 16px; line-height: 1.5; padding: 24px 20px 72px;
}
.lm * { box-sizing: border-box; }
.lm-wrap { max-width: 800px; margin: 0 auto; }
.lm a { color: var(--accent); }
.lm button:focus-visible, .lm input:focus-visible, .lm select:focus-visible,
.lm textarea:focus-visible, .lm a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.lm-top { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;
  padding-bottom: 16px; border-bottom: 1px solid var(--line); margin-bottom: 40px; }
.lm-brand { font-family: "Newsreader", Georgia, serif; font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
.brand-sub { font-family: "Public Sans", system-ui, sans-serif; font-size: 13px; font-weight: 500; color: var(--muted);
  letter-spacing: 0; margin-left: 6px; }
.lm-nav { display: flex; gap: 4px; background: #E4EAED; padding: 4px; border-radius: 999px; }
.lm-nav button { border: 0; background: transparent; padding: 6px 14px; border-radius: 999px; font: inherit;
  font-size: 14px; color: var(--muted); cursor: pointer; }
.lm-nav button.on { background: #fff; color: var(--ink); font-weight: 600; }

.lm-prompt { display: block; font-family: "Newsreader", Georgia, serif; font-size: clamp(30px, 5.5vw, 44px);
  line-height: 1.12; font-weight: 400; letter-spacing: -0.015em; margin-bottom: 18px; max-width: 17ch; }
.lm-hero textarea { width: 100%; font-family: "Newsreader", Georgia, serif; font-size: 21px; line-height: 1.45;
  color: var(--ink); background: transparent; border: 0; border-bottom: 2px solid var(--ink); border-radius: 0;
  padding: 6px 0 10px; resize: vertical; }
.lm-hero textarea::placeholder { color: #8795A0; font-style: italic; }
.lm-hero textarea:focus-visible { outline: none; border-bottom-color: var(--accent); }

.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.chip { border: 1px solid var(--line); background: #fff; border-radius: 999px; padding: 4px 12px; font: inherit;
  font-size: 14px; color: var(--ink); cursor: pointer; }
.chip:hover { border-color: var(--accent); color: var(--accent); }

.actions { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-top: 24px; }
.primary { background: var(--accent); color: #fff; border: 0; border-radius: 8px; padding: 11px 20px; font: inherit;
  font-weight: 600; cursor: pointer; }
.primary:hover { background: var(--accent-dk); }
.primary:disabled, .secondary:disabled { opacity: 0.6; cursor: default; }
.secondary { background: #fff; border: 1px solid #C2CDD2; color: var(--ink); border-radius: 8px; padding: 8px 14px;
  font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; white-space: nowrap; }
.secondary:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.danger { background: none; border: 1px solid #D6A29E; color: #A3302A; border-radius: 8px; padding: 8px 14px;
  font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.toggle { display: flex; gap: 8px; align-items: center; font-size: 15px; cursor: pointer; }
.toggle input, .radio input { accent-color: var(--accent); width: 16px; height: 16px; }

.dirbar { margin-top: 40px; padding: 14px 16px; background: #fff; border: 1px solid var(--line); border-radius: 8px; font-size: 14px; }
.dirbar p { margin: 0; }
.dirbar-top { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.dirbar-top p { flex: 1 1 320px; color: var(--muted); }
.check { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line); display: grid; gap: 10px; }
.check-head { font-weight: 600; color: var(--ink); }
.newlist { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 4px; }
.newlist li { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.newlist .link { margin-top: 0; }

.listhead { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin: 40px 0 10px; }
.listhead h2 { font-family: "Newsreader", Georgia, serif; font-size: 26px; font-weight: 600; margin: 0; }
.listhead .link { margin-top: 0; }

.lm-list { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
.lm-row { padding: 24px 0; border-bottom: 1px solid var(--line); }
.row-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.badge { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 600; padding: 3px 10px; border-radius: 999px; }
.badge::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.badge.open { background: #DDF0E4; color: #1C6B43; }
.badge.ask { background: #FAEDD2; color: #7E5509; }
.badge.closed { background: #E7EBED; color: #58626A; }
.badge.unknown { background: #fff; color: #66747C; box-shadow: inset 0 0 0 1px #CBD4D9; font-weight: 500; }
.area { font-size: 13px; color: var(--muted); }
.sample { font-size: 12px; color: var(--muted); border: 1px dashed #A9B6BC; border-radius: 4px; padding: 1px 6px; }
.lm-row h3 { font-family: "Newsreader", Georgia, serif; font-size: 24px; font-weight: 600; line-height: 1.2; margin: 10px 0 0; }
.labname { margin: 2px 0 0; font-size: 15px; font-weight: 500; }
.labname a { text-decoration: none; }
.labname a:hover { text-decoration: underline; }

.match { display: flex; align-items: center; gap: 10px; margin-top: 14px; }
.bar { width: 150px; height: 6px; background: #DFE6EA; border-radius: 3px; overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--accent); }
.pct { font-size: 14px; font-weight: 600; color: var(--accent-dk); }
.reason { margin: 6px 0 0; font-size: 15px; max-width: 68ch; }
.desc { margin: 12px 0 0; color: #33434E; max-width: 68ch; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.tag { font-size: 13px; background: #E4EAF6; color: var(--accent-dk); padding: 2px 9px; border-radius: 4px; }

.link { display: inline-block; background: none; border: 0; padding: 0; margin-top: 14px; font: inherit; font-size: 14px;
  font-weight: 600; color: var(--accent); cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }

.details { margin: 14px 0 0; background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 14px 18px; font-size: 15px; }
.drow { display: grid; grid-template-columns: 150px 1fr; gap: 16px; padding: 5px 0; }
.drow dt { color: var(--muted); }
.drow dd { margin: 0; overflow-wrap: anywhere; }
.note-inline { margin: 0 0 8px; padding-bottom: 10px; border-bottom: 1px solid var(--line); color: #33434E; }
.updated { margin: 10px 0 0; padding-top: 10px; border-top: 1px solid var(--line); font-size: 14px; color: var(--muted); }
.updated.stale { color: #7E5509; }

.lm-muted { color: var(--muted); }
.small { font-size: 14px; margin: 0 0 8px; }
.lm-empty { padding: 24px 0; color: var(--muted); }
.lm-error { color: #A3302A; font-size: 15px; margin: 12px 0 0; }
.lm-ok { color: #1C6B43; font-size: 15px; font-weight: 600; margin: 14px 0 0; }

.lm-title { font-family: "Newsreader", Georgia, serif; font-size: clamp(30px, 5vw, 38px); font-weight: 400;
  letter-spacing: -0.01em; line-height: 1.15; margin: 0 0 6px; }
.intro { margin: 0 0 8px; max-width: 64ch; }
.panel { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--line); }
.summary { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; }
.summary-name { font-family: "Newsreader", Georgia, serif; font-size: 22px; font-weight: 600; margin: 0; }
.summary .small { margin: 8px 0 0; }
.field { display: flex; flex-direction: column; gap: 5px; margin-top: 18px; }
.field label, .manage legend { font-size: 14px; font-weight: 600; }
.hint { font-size: 13px; color: var(--muted); margin-top: -2px; }
.field input, .field textarea, .field select { font: inherit; font-size: 15px; color: var(--ink); background: #fff;
  border: 1px solid #C2CDD2; border-radius: 6px; padding: 9px 11px; width: 100%; }
.field textarea { resize: vertical; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; align-items: end; }
.manage fieldset { border: 0; padding: 0; margin: 22px 0 0; }
.radios { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.radio { display: flex; align-items: center; gap: 8px; border: 1px solid #C2CDD2; background: #fff; border-radius: 6px;
  padding: 8px 12px; cursor: pointer; font-size: 15px; }
.radio.sel { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }

.sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.row-actions { display: flex; gap: 20px; flex-wrap: wrap; }
.sort { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--muted); }
.sort select { font: inherit; font-size: 14px; color: var(--ink); background: #fff; border: 1px solid #C2CDD2; border-radius: 6px; padding: 5px 8px; }

.stars { position: relative; display: inline-block; line-height: 1; font-size: 15px; letter-spacing: 1px; vertical-align: -1px; }
.stars-bg { color: #D3DAE0; }
.stars-fg { position: absolute; left: 0; top: 0; overflow: hidden; white-space: nowrap; color: #B87A0F; }
.rating-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 8px 0 0; font-size: 14px; }

.reviews { margin-top: 16px; padding: 18px; background: #fff; border: 1px solid var(--line); border-radius: 8px; }
.review-summary { display: flex; flex-wrap: wrap; gap: 12px 36px; align-items: flex-end; padding-bottom: 16px;
  margin-bottom: 16px; border-bottom: 1px solid var(--line); }
.review-summary .big { display: block; font-family: "Newsreader", Georgia, serif; font-size: 34px; font-weight: 600; line-height: 1; margin-bottom: 4px; }
.small-block { display: block; font-size: 13px; margin-top: 4px; }
.common { flex-basis: 100%; margin: 0; font-size: 14px; color: #33434E; }

.review-form { border-left: 3px solid var(--accent); padding-left: 16px; }
.form-title { font-family: "Newsreader", Georgia, serif; font-size: 21px; font-weight: 600; margin: 0 0 2px; }
.grid2.top { align-items: start; }
.grid3 { display: grid; grid-template-columns: 1.3fr 1fr 1fr; gap: 0 14px; align-items: end; }
.star-input, .plain { border: 0; padding: 0; margin: 18px 0 0; min-width: 0; }
.star-input legend, .plain legend { font-size: 14px; font-weight: 600; padding: 0; }
.star-row { display: flex; align-items: center; gap: 2px; margin-top: 4px; }
.star { position: relative; font-size: 28px; line-height: 1; color: #CBD3D9; cursor: pointer; padding: 0 1px; border-radius: 4px; }
.star.on { color: #B87A0F; }
.star:hover { color: #D69A2E; }
.star:focus-within { outline: 2px solid var(--accent); outline-offset: 1px; }
.star-caption { margin-left: 10px; font-size: 14px; color: var(--muted); }
.plain .chips { margin-top: 8px; }
.chip.sel { background: var(--accent); border-color: var(--accent); color: #fff; }
.counter { font-size: 13px; color: var(--muted); }
.counter.ok { color: #1C6B43; }
.agree { display: flex; gap: 10px; align-items: flex-start; margin-top: 20px; font-size: 14px; color: #33434E; cursor: pointer; }
.agree input { margin-top: 3px; accent-color: var(--accent); width: 16px; height: 16px; flex: none; }

.review-list { list-style: none; margin: 20px 0 0; padding: 0; }
.review { padding: 16px 0; border-top: 1px solid var(--line); }
.review-top { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 14px; }
.rec { font-size: 13px; font-weight: 600; padding: 1px 8px; border-radius: 999px; }
.rec.yes { background: #DDF0E4; color: #1C6B43; }
.rec.no { background: #F6E1DF; color: #A3302A; }
.project { margin: 8px 0 0; font-weight: 600; }
.review-meta { margin: 2px 0 0; font-size: 14px; color: var(--muted); }
.tag.plain { background: #EEF1F3; color: #3F4E58; }
.comment { margin: 10px 0 0; white-space: pre-wrap; max-width: 68ch; }
.review-foot { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 10px; font-size: 14px; }
.review-foot .link { margin-top: 0; }
.muted-link { color: var(--muted) !important; font-weight: 500 !important; }
.foot-actions { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
.site-foot { margin-top: 64px; padding-top: 20px; border-top: 1px solid var(--line); font-size: 13px; color: var(--muted); }
.site-foot p { margin: 0 0 6px; max-width: 72ch; }
.admin-note { color: #1C6B43; font-weight: 600; }

@media (max-width: 560px) {
  .grid3 { grid-template-columns: 1fr; }
  .grid2 { grid-template-columns: 1fr; }
  .drow { grid-template-columns: 1fr; gap: 0; }
  .brand-sub { display: block; margin-left: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .lm * { transition: none !important; animation: none !important; }
}
`;
