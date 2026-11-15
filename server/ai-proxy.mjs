// EARTHSCOPE optional AI proxy — turns computed trend statistics into a
// plain-language scientific explanation with Claude.
//
//   ANTHROPIC_API_KEY=... node server/ai-proxy.mjs          (port 8787)
//   then run the app with VITE_AI_ENDPOINT=/api/interpret     (Vite proxies /api → :8787)
//
// The browser never sees the API key. The proxy receives ONLY the numbers
// EARTHSCOPE already computed (no raw data, no personal information) and the
// user's question, and returns { answer, model }.
import http from "node:http";
import Anthropic from "@anthropic-ai/sdk";

const PORT = Number(process.env.AI_PROXY_PORT ?? 8787);
const MODEL = process.env.EARTHSCOPE_AI_MODEL ?? "claude-opus-5-5";
const MAX_BODY = 64 * 1024;

const SYSTEM_PROMPT = `You are the AI Scientist inside EARTHSCOPE, a tool that helps high-school and college students investigate trends in NASA Earth-science data (NASA POWER / MERRA-2 reanalysis, MODIS, NSIDC sea ice, GISTEMP).

You receive the user's question and a JSON list of results that EARTHSCOPE has ALREADY COMPUTED for their investigation: variable, region, years, data source, trend per decade, 95% confidence interval, p-value, significance at alpha, method, percent of mean per decade (null for temperature-like variables), Mann-Kendall tau, an autocorrelation-adjusted regression, an estimate of years needed to detect the trend, and missing-data percentage.

Rules:
- Use only the numbers provided. Never invent data, values, citations or results. If the question needs data that isn't provided, say what would be needed and how to get it in EARTHSCOPE.
- Keep measured evidence and explanation separate. Label every causal explanation as a hypothesis that has not been tested, and suggest a concrete way to test it with other variables or regions.
- A trend that is not statistically significant is still worth discussing; say whether a longer record might change the conclusion (use the years-to-detect estimate).
- Distinguish statistical significance from practical importance. Correlation or co-occurring trends do not establish causation.
- Note relevant limitations (reanalysis data, regional averaging, short records, autocorrelation).
- Write for a curious student: clear, precise, friendly, under about 250 words, plain prose with at most a short list.`;

const client = new Anthropic(); // reads ANTHROPIC_API_KEY (or another configured credential)

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function interpret(question, results) {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium" },
    // Opt-in server-side fallback: if the request is declined, the API re-runs it on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Computed results (JSON):\n${JSON.stringify(results, null, 2)}\n\nQuestion: ${question}`,
      },
    ],
  });
  if (response.stop_reason === "refusal") {
    const why = response.stop_details?.explanation;
    return { answer: `The AI model declined to answer this question${why ? ` (${why})` : ""}. Try rephrasing it around the computed results.`, model: response.model };
  }
  const answer = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n\n")
    .trim();
  return { answer: answer || "No answer was returned.", model: response.model };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/api/health") return send(res, 200, { ok: true, model: MODEL });
  if (req.method !== "POST" || req.url !== "/api/interpret") return send(res, 404, { error: "Not found" });
  try {
    const body = await readJson(req);
    const question = typeof body.question === "string" ? body.question.slice(0, 1000).trim() : "";
    const results = Array.isArray(body.results) ? body.results.slice(0, 12) : [];
    if (!question) return send(res, 400, { error: "Missing question" });
    send(res, 200, await interpret(question, results));
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return send(res, 401, { error: "AI proxy is not authorised — check ANTHROPIC_API_KEY." });
    if (err instanceof Anthropic.RateLimitError) return send(res, 429, { error: "AI rate limit reached — try again shortly." });
    if (err instanceof Anthropic.BadRequestError) return send(res, 400, { error: `AI request rejected: ${err.message}` });
    if (err instanceof Anthropic.APIError) return send(res, 502, { error: `AI service error ${err.status ?? ""}`.trim() });
    if (err instanceof SyntaxError) return send(res, 400, { error: "Invalid JSON body" });
    send(res, err.status ?? 500, { error: err.message ?? "Internal error" });
  }
});

server.listen(PORT, () => console.log(`EARTHSCOPE AI proxy on http://localhost:${PORT} (model ${MODEL})`));
