import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, BrainCircuit, Database, Eraser, Sparkles } from "lucide-react";
import { useEntries, isReady } from "@/hooks/useEntries";
import { newId, useInvestigation } from "@/store/investigation";
import { InvestigationRail } from "@/components/scientific/InvestigationRail";
import { AnalystBlocks } from "@/components/scientific/AnalystBlocks";
import { Sparkline } from "@/components/charts/Sparkline";
import { AIBadge, TrendBadge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { AI_ENDPOINT, answer, suggestedPrompts, type AnalystBlock, type AnalystResponse } from "@/services/analyst";
import { fmtP, fmtSigned } from "@/utils/format";
import { resultAnnualUnit } from "@/utils/trend";
import { cn } from "@/utils/cn";
import { singleSeriesPolicy } from "@/data/significance";
import { plainSentence } from "@/utils/plainSentence";

interface Msg {
  id: number;
  role: "user" | "analyst";
  text?: string;
  response?: AnalystResponse;
  pending?: boolean;
}

export default function AIScientistPage() {
  const entries = useEntries().filter(isReady);
  const config = useInvestigation((s) => s.config);
  const status = useInvestigation((s) => s.status);
  const run = useInvestigation((s) => s.run);
  const navigate = useNavigate();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const ctx = useMemo(() => ({ entries: entries.map((e) => ({ series: e.series, result: e.result, variable: e.variable, region: e.region })) }), [entries]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs]);

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    setInput("");
    setBusy(true);
    const id = Date.now();
    setMsgs((m) => [...m, { id, role: "user", text: question }, { id: id + 1, role: "analyst", pending: true }]);
    const res = await answer(question, { ...ctx, question });
    setMsgs((m) => m.map((x) => (x.id === id + 1 ? { ...x, pending: false, response: res } : x)));
    setBusy(false);
  };

  // Chips are built from this case, so every one of them can be answered.
  const prompts = useMemo(() => suggestedPrompts(ctx), [ctx]);

  // One click: add the variable the question asked about, and run the analysis.
  const addVariable = (b: Extract<AnalystBlock, { type: "action" }>) => {
    if (!config || config.variableIds.includes(b.variableId)) return;
    void run({ ...config, id: newId(), variableIds: [...config.variableIds, b.variableId] });
    navigate("/workspace");
  };

  return (
    <div className="min-h-dvh pt-[var(--nav-h)]">
      <InvestigationRail />
      <div className="container-x py-8">
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          {/* Context sidebar */}
          <aside className="space-y-4 lg:sticky lg:top-[calc(var(--nav-h)+4rem)] lg:self-start" aria-label="Scientific context">
            <div className="panel p-5">
              <div className="label-mono mb-3 flex items-center gap-2">
                <Database className="h-3.5 w-3.5 text-[var(--color-cyan)]" /> Scientific context
              </div>
              {config ? (
                <>
                  <p className="text-sm text-[var(--color-ink)]">{config.question}</p>
                  <p className="mt-1 text-xs text-[var(--color-ink-4)]">
                    {config.startYear}–{config.endYear} · {config.regions.map((r) => r.name).join(", ")}
                  </p>
                </>
              ) : (
                <p className="text-sm text-[var(--color-ink-3)]">No investigation loaded. The analyst can still define terms and explain methods.</p>
              )}
              <div className="mt-4 space-y-2.5">
                {entries.map((e) => (
                  <div key={e.series.id} className="rounded-[var(--radius-md)] border border-[var(--color-line)] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-[var(--color-ink-2)]">
                        {e.variable.name} · {e.region?.name}
                      </span>
                      <TrendBadge direction={e.result.summary.direction} significant={e.result.summary.significant} compact />
                    </div>
                    <p className="mt-1.5 text-[12px] leading-snug text-[var(--color-ink-2)]">{plainSentence(e.result, e.variable, e.region?.name)}</p>
                    <Sparkline points={e.result.annual} height={34} className="mt-2" ariaLabel={`Annual ${e.variable.name} sparkline`} />
                    <div className="num mt-1 font-mono text-[11px] text-[var(--color-ink-3)]">
                      {fmtSigned(e.result.summary.perDecade, e.variable.decimals)} {resultAnnualUnit(e.result, e.variable)}/dec · p {fmtP(e.result.summary.p)}
                    </div>
                  </div>
                ))}
              </div>
              {!entries.length && (
                <ButtonLink to="/investigate" variant="secondary" size="sm" className="mt-4 w-full">
                  Start an investigation
                </ButtonLink>
              )}
            </div>
            <div className="rounded-[var(--radius-lg)] border border-[rgb(155_140_255/.3)] bg-[var(--color-violet-soft)] p-4 text-xs leading-relaxed text-[var(--color-ink-2)]">
              <div className="mb-1.5 flex items-center gap-2">
                <AIBadge engine={AI_ENDPOINT ? "remote" : "local"} />
              </div>
              {AI_ENDPOINT
                ? "Answers are written by a language model that sees only your computed results. The measured evidence shown with each answer comes straight from your data."
                : "Answers come only from your computed results. No numbers are invented, and every possible explanation is labelled as an untested hypothesis."}
              <span className="mt-1.5 block text-[var(--color-ink-3)]">{singleSeriesPolicy(entries[0]?.result.summary.alpha)}</span>
            </div>
          </aside>

          {/* Conversation */}
          <section className="panel flex min-h-[calc(100dvh-var(--nav-h)-8rem)] flex-col" aria-label="Conversation with the AI Scientist">
            <div className="flex items-center justify-between border-b border-[var(--color-line)] px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[rgb(155_140_255/.45)] bg-[var(--color-violet-soft)]">
                  <BrainCircuit className="h-4 w-4 text-[var(--color-violet)]" />
                </div>
                <div>
                  <h1 className="font-display text-base leading-tight">AI Scientist</h1>
                  <p className="text-[11px] text-[var(--color-ink-4)]">Your investigation companion — evidence first, hypotheses clearly marked</p>
                </div>
              </div>
              {msgs.length > 0 && (
                <Button variant="ghost" size="sm" icon={<Eraser className="h-3.5 w-3.5" />} onClick={() => setMsgs([])}>
                  Clear
                </Button>
              )}
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto px-5 py-6" aria-live="polite">
              {msgs.length === 0 && (
                <div className="mx-auto max-w-xl py-10 text-center">
                  <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-[rgb(155_140_255/.4)] bg-[var(--color-violet-soft)]">
                    <Sparkles className="h-6 w-6 text-[var(--color-violet)]" />
                  </div>
                  <h2 className="font-display text-2xl tracking-[-0.02em]">Ask about your findings</h2>
                  <p className="mt-2 text-sm text-[var(--color-ink-3)]">I explain statistics, propose testable hypotheses, and suggest what to investigate next — using only results computed from your data.</p>
                </div>
              )}
              <AnimatePresence initial={false}>
                {msgs.map((m) =>
                  m.role === "user" ? (
                    <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
                      <div className="max-w-[80%] rounded-[var(--radius-lg)] rounded-br-sm border border-[var(--color-line-strong)] bg-[var(--color-surface-2)] px-4 py-2.5 text-sm">{m.text}</div>
                    </motion.div>
                  ) : (
                    <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3">
                      <div className="mt-1 h-full w-0.5 shrink-0 self-stretch rounded-full bg-gradient-to-b from-[var(--color-violet)] to-transparent" />
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="label-mono text-[#c9c0ff]">Analyst</span>
                          {m.response && <AIBadge engine={m.response.engine} />}
                        </div>
                        {m.pending ? (
                          <div className="space-y-2">
                            <div className="skeleton h-3 w-3/4" />
                            <div className="skeleton h-3 w-2/3" />
                            <div className="skeleton h-3 w-1/2" />
                          </div>
                        ) : (
                          m.response && (
                            <>
                              <AnalystBlocks blocks={m.response.blocks} onAction={config ? addVariable : undefined} actionBusy={status === "loading"} />
                              {m.response.sources.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                  {m.response.sources.map((s) => (
                                    <span key={s} className="max-w-full truncate rounded-full border border-[var(--color-line)] px-2 py-0.5 text-[10.5px] text-[var(--color-ink-3)]" title={s}>
                                      ⧉ {s}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </>
                          )
                        )}
                      </div>
                    </motion.div>
                  ),
                )}
              </AnimatePresence>
              <div ref={endRef} />
            </div>

            <div className="border-t border-[var(--color-line)] p-4">
              <div className="mb-3 flex flex-wrap gap-2">
                {prompts.map((p) => (
                  <button
                    key={p}
                    onClick={() => void ask(p)}
                    disabled={busy}
                    className="rounded-full border border-[rgb(155_140_255/.3)] px-3 py-1.5 text-xs text-[#d6d0ff] transition-colors hover:bg-[var(--color-violet-soft)] disabled:opacity-40"
                  >
                    {p}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask(input);
                }}
                className="relative"
              >
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void ask(input);
                    }
                  }}
                  rows={2}
                  placeholder={prompts[0] ?? "Ask about your results"}
                  aria-label="Ask the AI Scientist"
                  className="w-full resize-none rounded-[var(--radius-lg)] border border-[var(--color-line-strong)] bg-[var(--color-surface-2)] py-3 pl-4 pr-14 text-sm placeholder:text-[var(--color-ink-4)] focus:border-[var(--color-violet)] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || busy}
                  aria-label="Send question"
                  className={cn("absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full transition-colors", input.trim() ? "bg-[var(--color-violet)] text-[#0b0820]" : "bg-white/5 text-[var(--color-ink-4)]")}
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              </form>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
