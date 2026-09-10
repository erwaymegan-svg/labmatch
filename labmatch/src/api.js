export const ADMIN_KEY = "labmatch-admin-token";

// Small helper for calling the Netlify function at /api/*.
export async function api(path, { method = "GET", body } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  try {
    const token = localStorage.getItem(ADMIN_KEY);
    if (token) headers["x-admin-token"] = token;
  } catch (e) {
    // Storage blocked; continue without admin token.
  }
  const res = await fetch(`/api/${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch (e) {
    // Non-JSON response.
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}). Try again in a moment.`);
  return data;
}
