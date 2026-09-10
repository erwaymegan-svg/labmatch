// Calls the Claude API using the ANTHROPIC_API_KEY environment variable set in Netlify.
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

export async function askClaude(prompt, maxTokens = 1500) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set in Netlify environment variables.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

export function parseJsonArray(text) {
  const match = text.replace(/```json|```/g, "").match(/\[[\s\S]*\]/);
  if (!match) throw new Error("Claude did not return a JSON array.");
  const value = JSON.parse(match[0]);
  if (!Array.isArray(value)) throw new Error("Claude did not return a JSON array.");
  return value;
}
