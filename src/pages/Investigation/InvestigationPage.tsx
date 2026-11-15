import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, CircleAlert, Crosshair, Pause, Play, Sparkles, SquareDashedMousePointer, X } from "lucide-react";
import type { InvestigationConfig, MethodId, Region } from "@/types/domain";
import { CATEGORIES, VARIABLES, getVariable } from "@/data/catalog";
import { DEMO_BY_ID, DEMOS } from "@/data/demos";
import { NAMED_REGION_BY_ID, bboxRegion, parseCoordinates } from "@/data/regions";
import { countryToRegion, findCountry } from "@/services/geo";
import { parseQuestion, type ParsedQuestion } from "@/services/questionParser";
import { newId, useInvestigation } from "@/store/investigation";
import { RegionMap } from "@/components/maps/RegionMap";
import { PlaceSearch } from "@/components/maps/PlaceSearch";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Segmented, Select, TextInput } from "@/components/ui/Controls";
import { cn } from "@/utils/cn";

const STEPS = ["Question", "Variables", "Region", "Time range", "Methods", "Review"] as const;
const THIS_YEAR_COMPLETE = 2025;

const TOPICS: { label: string; q: string }[] = [
  { label: "Heat", q: "Is air temperature increasing in " },
  { label: "Rain & drought", q: "Is precipitation decreasing in " },
  { label: "Soil & farming", q: "Is soil moisture decreasing in " },
  { label: "Air quality", q: "Are aerosols increasing over " },
  { label: "Ozone", q: "Is total ozone changing over " },
  { label: "Oceans", q: "Is sea surface temperature rising in " },
];

const METHODS: { id: MethodId; label: string; desc: string }[] = [
  { id: "mann-kendall", label: "Mann-Kendall test", desc: "Rank-based significance test for a monotonic trend (annual values)." },
  { id: "sen", label: "Sen's slope", desc: "Robust trend rate — median of all pairwise slopes." },
  { id: "ols", label: "Linear regression (t-test)", desc: "Least-squares line on deseasonalised monthly anomalies, autocorrelation-adjusted." },
  { id: "ci", label: "95% confidence intervals", desc: "Plausible range of the true trend for every method." },
  { id: "seasonal", label: "Seasonal analysis", desc: "Seasonal Kendall test + climatology shift between decades." },
];

async function resolveDemoRegions(refs: { kind: "country" | "named"; ref: string }[]): Promise<Region[]> {
  const out: Region[] = [];
  for (const r of refs) {
    if (r.kind === "named") {
      const n = NAMED_REGION_BY_ID[r.ref];
      if (n) out.push(n);
    } else {
      const c = await findCountry(r.ref);
      if (c) out.push(countryToRegion(c));
    }
  }
  return out;
}

export default function InvestigationPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const run = useInvestigation((s) => s.run);
  const setPrimary = useInvestigation((s) => s.setPrimary);
  const storePrimary = useInvestigation((s) => s.primary);

  const [step, setStep] = useState(0);
  const [question, setQuestion] = useState("");
  const [parsed, setParsed] = useState<ParsedQuestion | null>(null);
  const [variableIds, setVariableIds] = useState<string[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [startYear, setStartYear] = useState(1981);
  const [endYear, setEndYear] = useState(THIS_YEAR_COMPLETE);
  const [methods, setMethods] = useState<MethodId[]>(["mann-kendall", "sen", "ols", "ci", "seasonal"]);
  const [alpha, setAlpha] = useState(0.05);
  const [primary, setPrimaryLocal] = useState(storePrimary);
  const [drawMode, setDrawMode] = useState(false);
  const [coordText, setCoordText] = useState("");

  // demo playback
  const demoId = params.get("demo");
  const demo = demoId ? DEMO_BY_ID[demoId] : undefined;
  const [playing, setPlaying] = useState(false);
  const [narration, setNarration] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  // Preselect from ?v=
  useEffect(() => {
    const v = params.get("v");
    if (v && getVariable(v)) setVariableIds((ids) => (ids.includes(v) ? ids : [...ids, v]));
  }, [params]);

  // Parse the question (debounced)
  useEffect(() => {
    if (!question.trim()) {
      setParsed(null);
      return;
    }
    const t = setTimeout(() => parseQuestion(question).then(setParsed), 250);
    return () => clearTimeout(t);
  }, [question]);

  const minStart = useMemo(() => {
    const starts = variableIds
      .map((id) => getVariable(id)?.connector)
      .map((c) => (c && c.kind === "power" ? c.startYear : 1981));
    return Math.max(1981, ...starts);
  }, [variableIds]);
  useEffect(() => {
    if (startYear < minStart) setStartYear(minStart);
  }, [minStart, startYear]);

  const liveVars = variableIds.filter((id) => getVariable(id)?.connector.kind === "power");
  const importVars = variableIds.filter((id) => getVariable(id)?.connector.kind !== "power");
  const years = endYear - startYear + 1;

  const issues = useMemo(() => {
    const out: { level: "error" | "warn"; text: string }[] = [];
    if (!question.trim()) out.push({ level: "warn", text: "No research question written — one will be generated from your selections." });
    if (!variableIds.length) out.push({ level: "error", text: "Choose at least one variable." });
    if (variableIds.length && !liveVars.length) out.push({ level: "error", text: "None of the chosen variables can be fetched in-app. Pick a NASA POWER variable, or use Import in the Workspace." });
    if (importVars.length) out.push({ level: "warn", text: `${importVars.map((i) => getVariable(i)?.name).join(", ")}: not retrievable live — use a bundled dataset or import a Giovanni/AppEEARS CSV in the Workspace.` });
    if (!regions.length) out.push({ level: "error", text: "Choose at least one region." });
    if (years < 10) out.push({ level: "error", text: "Use at least 10 years — trend tests need a long record." });
    else if (years < 20) out.push({ level: "warn", text: `${years} years is short; small trends may not reach significance.` });
    if (!methods.length) out.push({ level: "error", text: "Select at least one analysis method." });
    if (regions.length * Math.max(1, liveVars.length) > 12) out.push({ level: "warn", text: "Many region × variable combinations — fetching may take a minute." });
    return out;
  }, [question, variableIds, liveVars.length, importVars, regions.length, years, methods.length]);
  const blocking = issues.some((i) => i.level === "error");

  const toggleVar = (id: string) => setVariableIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= 4 ? ids : [...ids, id]));
  const addRegion = (r: Region) => setRegions((rs) => (rs.some((x) => x.id === r.id) ? rs : [...rs, r].slice(-4)));

  const launch = useCallback(
    (cfgOverride?: Partial<InvestigationConfig>, page?: string) => {
      const vs = cfgOverride?.variableIds ?? variableIds;
      const rs = cfgOverride?.regions ?? regions;
      const q =
        (cfgOverride?.question ?? question).trim() ||
        `How has ${vs.map((v) => getVariable(v)?.name.toLowerCase()).join(" and ")} changed in ${rs.map((r) => r.name).join(" vs ")}?`;
      const config: InvestigationConfig = {
        id: newId(),
        question: q,
        variableIds: vs,
        regions: rs,
        startYear: cfgOverride?.startYear ?? startYear,
        endYear: cfgOverride?.endYear ?? endYear,
        resolution: "monthly",
        methods: cfgOverride?.methods ?? methods,
        alpha,
        createdAt: new Date().toISOString(),
        demoId: cfgOverride?.demoId,
      };
      if (primary !== storePrimary) setPrimary(primary);
      void run(config);
      navigate(page ?? (rs.length > 1 ? "/compare" : "/workspace"));
    },
    [variableIds, regions, question, startYear, endYear, methods, alpha, primary, storePrimary, setPrimary, run, navigate],
  );

  /* ------------------------------ demo mode ------------------------------ */
  useEffect(() => {
    if (!demo) return;
    let cancelled = false;
    (async () => {
      const rs = await resolveDemoRegions(demo.regions);
      if (cancelled) return;
      setQuestion("");
      setVariableIds([]);
      setRegions([]);
      setStep(0);
      setPlaying(true);
      const script: (() => void)[] = [
        () => {
          setStep(0);
          setQuestion(demo.question);
          setNarration(demo.narration[0]);
        },
        () => {
          setStep(1);
          setVariableIds(demo.variableIds);
          setNarration(demo.narration[1] ?? "We pick the variable that answers the question.");
        },
        () => {
          setStep(2);
          setRegions(rs);
          setNarration(demo.narration[2] ?? `Region${rs.length > 1 ? "s" : ""}: ${rs.map((r) => r.name).join(", ")}.`);
        },
        () => {
          setStep(3);
          setStartYear(demo.startYear);
          setEndYear(demo.endYear);
          setNarration(demo.narration[3] ?? `${demo.endYear - demo.startYear + 1} years of monthly data.`);
        },
        () => {
          setStep(4);
          setNarration(demo.narration[4] ?? "We test with Mann-Kendall, Sen's slope and regression with confidence intervals.");
        },
        () => {
          setStep(5);
          setNarration("Review — then EARTHSCOPE fetches the data and computes everything live.");
        },
      ];
      let i = 0;
      const tick = () => {
        if (cancelled) return;
        if (i < script.length) {
          script[i++]();
          timer.current = window.setTimeout(tick, 3600);
        } else {
          setPlaying(false);
          launch(
            { question: demo.question, variableIds: demo.variableIds, regions: rs, startYear: demo.startYear, endYear: demo.endYear, demoId: demo.id },
            demo.page === "compare" ? "/compare" : demo.page === "relationships" ? "/relationships" : "/workspace",
          );
        }
      };
      tick();
    })();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoId]);

  const stopDemo = () => {
    if (timer.current) clearTimeout(timer.current);
    setPlaying(false);
    setNarration(null);
    navigate("/investigate", { replace: true });
  };

  const canNext = step === 1 ? variableIds.length > 0 : step === 2 ? regions.length > 0 : true;

  return (
    <div className="relative min-h-dvh pt-[var(--nav-h)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[480px] bg-[radial-gradient(ellipse_50%_80%_at_50%_0%,rgb(56_140_255/.10),transparent)]" />
      <div className="container-x relative py-10 md:py-14">
        <header className="mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <div className="label-mono mb-3 flex items-center gap-2">
              <span className="text-[var(--color-cyan)]">New investigation</span>
              {demo && <Badge tone="cyan">Demo · {demo.title}</Badge>}
            </div>
            <h1 className="font-display text-[clamp(2rem,4vw,3.2rem)] leading-[1.05] tracking-[-0.03em]">Set up your investigation</h1>
            <p className="mt-2 max-w-[60ch] text-sm text-[var(--color-ink-3)]">Six short steps. Every result is computed from real NASA data after you press Run.</p>
          </div>
          {!demo && (
            <div className="flex flex-wrap gap-2">
              <Select aria-label="Watch a demonstration" value="" onChange={(e) => e.target.value && navigate(`/investigate?demo=${e.target.value}`)} className="w-64">
                <option value="">▶ Watch a demonstration…</option>
                {DEMOS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </header>

        {/* Stepper */}
        <ol className="mb-8 grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Wizard steps">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button
                onClick={() => !playing && setStep(i)}
                aria-current={i === step ? "step" : undefined}
                className={cn(
                  "group w-full text-left",
                  playing && "pointer-events-none",
                )}
              >
                <div className={cn("h-[2px] w-full rounded-full transition-colors duration-500", i < step ? "bg-[var(--color-ice)]" : i === step ? "bg-[var(--color-cyan)] shadow-[0_0_10px_var(--color-cyan)]" : "bg-white/10")} />
                <div className="mt-2 flex items-center gap-2">
                  <span className={cn("font-mono text-[10.5px]", i <= step ? "text-[var(--color-cyan)]" : "text-[var(--color-ink-4)]")}>{String(i + 1).padStart(2, "0")}</span>
                  <span className={cn("text-xs", i === step ? "text-[var(--color-ink)]" : "text-[var(--color-ink-3)] group-hover:text-[var(--color-ink-2)]")}>{s}</span>
                </div>
              </button>
            </li>
          ))}
        </ol>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="panel min-h-[520px] p-5 md:p-8">
            <AnimatePresence mode="wait">
              <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.35 }}>
                {step === 0 && (
                  <section aria-labelledby="s0">
                    <h2 id="s0" className="font-display text-2xl tracking-[-0.02em]">What do you want to find out?</h2>
                    <p className="mt-1 text-sm text-[var(--color-ink-3)]">Ask in your own words — mention a variable and a place. Example: “Is precipitation decreasing in Jordan?”</p>
                    <textarea
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      rows={3}
                      aria-label="Research question"
                      placeholder="Is precipitation decreasing in Jordan?"
                      className="mt-5 w-full resize-none rounded-[var(--radius-lg)] border border-[var(--color-line-strong)] bg-[var(--color-surface-2)] p-4 font-display text-xl tracking-[-0.01em] text-[var(--color-ink)] placeholder:text-[var(--color-ink-4)] focus:border-[var(--color-cyan)] focus:outline-none"
                    />
                    <div className="mt-4">
                      <div className="label-mono mb-2">Not sure? Start from a topic</div>
                      <div className="flex flex-wrap gap-2">
                        {TOPICS.map((t) => (
                          <button
                            key={t.label}
                            onClick={() => setQuestion(t.q)}
                            className="rounded-full border border-[var(--color-line-strong)] px-3 py-1.5 text-xs text-[var(--color-ink-2)] transition-colors hover:border-[var(--color-cyan)] hover:text-[var(--color-ink)]"
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {parsed && (parsed.variables.length > 0 || parsed.regions.length > 0 || parsed.regionTypeHints.length > 0) && (
                      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-6 rounded-[var(--radius-lg)] border border-[rgb(56_225_255/.25)] bg-[rgb(56_225_255/.04)] p-4">
                        <div className="mb-3 flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-[var(--color-cyan)]" />
                          <span className="label-mono text-[var(--color-cyan)]">EARTHSCOPE understood</span>
                          {parsed.direction && <Badge tone="neutral">expects {parsed.direction}</Badge>}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {parsed.variables.map((pv) => {
                            const v = getVariable(pv.id)!;
                            const on = variableIds.includes(pv.id);
                            return (
                              <button key={pv.id} onClick={() => toggleVar(pv.id)} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors", on ? "border-[var(--color-cyan)] bg-[var(--color-cyan-soft)] text-[var(--color-ink)]" : "border-[var(--color-line-strong)] text-[var(--color-ink-2)] hover:border-[var(--color-line-bright)]")}>
                                {on ? <Check className="h-3 w-3" /> : "+"} {v.name}
                                <span className="text-[var(--color-ink-4)]">“{pv.matched}”</span>
                              </button>
                            );
                          })}
                          {parsed.regions.map((r) => {
                            const on = regions.some((x) => x.id === r.id);
                            return (
                              <button key={r.id} onClick={() => (on ? setRegions((rs) => rs.filter((x) => x.id !== r.id)) : addRegion(r))} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs", on ? "border-[var(--color-ice)] bg-[var(--color-ice-soft)]" : "border-[var(--color-line-strong)] text-[var(--color-ink-2)]")}>
                                {on ? <Check className="h-3 w-3" /> : <Crosshair className="h-3 w-3" />} {r.name}
                              </button>
                            );
                          })}
                        </div>
                        {parsed.regionTypeHints.map((h) => (
                          <div key={h.hint} className="mt-3 text-xs text-[var(--color-ink-3)]">
                            Regions that match “{h.hint}”:{" "}
                            {h.suggestions.map((r) => (
                              <button key={r.id} onClick={() => addRegion(r)} className="mr-2 text-[var(--color-ice)] hover:underline">
                                {r.name}
                              </button>
                            ))}
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </section>
                )}

                {step === 1 && (
                  <section aria-labelledby="s1">
                    <h2 id="s1" className="font-display text-2xl tracking-[-0.02em]">Which variables?</h2>
                    <p className="mt-1 text-sm text-[var(--color-ink-3)]">Choose up to four. <span className="text-[var(--color-cyan)]">Live</span> variables are fetched in-app from NASA POWER.</p>
                    <div className="mt-6 space-y-6">
                      {CATEGORIES.map((c) => (
                        <div key={c.id}>
                          <div className="label-mono mb-2">{c.label}</div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {VARIABLES.filter((v) => v.category === c.id).map((v) => {
                              const on = variableIds.includes(v.id);
                              const live = v.connector.kind === "power";
                              return (
                                <button
                                  key={v.id}
                                  onClick={() => toggleVar(v.id)}
                                  aria-pressed={on}
                                  className={cn(
                                    "group flex items-start gap-3 rounded-[var(--radius-md)] border p-3 text-left transition-colors",
                                    on ? "border-[var(--color-cyan)] bg-[var(--color-cyan-soft)]" : "border-[var(--color-line)] hover:border-[var(--color-line-strong)] hover:bg-white/[0.02]",
                                  )}
                                >
                                  <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border", on ? "border-[var(--color-cyan)] bg-[var(--color-cyan)] text-[#021018]" : "border-[var(--color-line-bright)]")}>
                                    {on && <Check className="h-3 w-3" />}
                                  </span>
                                  <span className="min-w-0">
                                    <span className="flex items-center gap-2">
                                      <span className="text-sm text-[var(--color-ink)]">{v.name}</span>
                                      <span className={cn("font-mono text-[9.5px] uppercase tracking-[0.12em]", live ? "text-[var(--color-cyan)]" : "text-[var(--color-ink-4)]")}>{live ? "live" : v.connector.kind === "bundled" ? "bundled" : "import"}</span>
                                    </span>
                                    <span className="mt-0.5 line-clamp-2 block text-xs text-[var(--color-ink-3)]">{v.definition}</span>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {step === 2 && (
                  <section aria-labelledby="s2">
                    <h2 id="s2" className="font-display text-2xl tracking-[-0.02em]">Where?</h2>
                    <p className="mt-1 text-sm text-[var(--color-ink-3)]">Click a country, search, draw a box, or type coordinates. Add up to four regions to compare them.</p>
                    <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto_auto]">
                      <PlaceSearch onSelect={addRegion} />
                      <form
                        className="flex gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const r = parseCoordinates(coordText);
                          if (r) {
                            addRegion(r);
                            setCoordText("");
                          }
                        }}
                      >
                        <TextInput aria-label="Coordinates (lat, lon)" placeholder="lat, lon" value={coordText} onChange={(e) => setCoordText(e.target.value)} className="h-11 w-36" />
                        <Button type="submit" variant="subtle" className="h-11">Add</Button>
                      </form>
                      <Button variant={drawMode ? "primary" : "secondary"} className="h-11" icon={<SquareDashedMousePointer className="h-4 w-4" />} onClick={() => setDrawMode((d) => !d)} aria-pressed={drawMode}>
                        {drawMode ? "Drawing…" : "Draw box"}
                      </Button>
                    </div>
                    <RegionMap
                      className="mt-4"
                      regions={regions}
                      interactive
                      drawMode={drawMode}
                      fit="world"
                      height={380}
                      onSelectCountry={addRegion}
                      onDrawBox={(b) => {
                        addRegion(bboxRegion(b));
                        setDrawMode(false);
                      }}
                      ariaLabel="Interactive world map: click a country to select it"
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      {regions.map((r) => (
                        <span key={r.id} className="inline-flex items-center gap-2 rounded-full border border-[var(--color-ice)] bg-[var(--color-ice-soft)] py-1 pl-3 pr-1 text-xs">
                          {r.name}
                          <button aria-label={`Remove ${r.name}`} onClick={() => setRegions((rs) => rs.filter((x) => x.id !== r.id))} className="rounded-full p-1 hover:bg-white/10">
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                      {!regions.length && <span className="text-xs text-[var(--color-ink-4)]">No region selected yet.</span>}
                    </div>
                  </section>
                )}

                {step === 3 && (
                  <section aria-labelledby="s3">
                    <h2 id="s3" className="font-display text-2xl tracking-[-0.02em]">Over what period?</h2>
                    <p className="mt-1 text-sm text-[var(--color-ink-3)]">Longer records detect smaller trends. Monthly data are used; tests run on annual values and deseasonalised anomalies.</p>
                    <div className="mt-6 grid gap-4 sm:grid-cols-3">
                      <TextInput label="Start year" type="number" min={minStart} max={endYear - 1} value={startYear} onChange={(e) => setStartYear(Math.max(minStart, Math.min(endYear - 1, +e.target.value || minStart)))} />
                      <TextInput label="End year" type="number" min={startYear + 1} max={THIS_YEAR_COMPLETE} value={endYear} onChange={(e) => setEndYear(Math.min(THIS_YEAR_COMPLETE, Math.max(startYear + 1, +e.target.value || THIS_YEAR_COMPLETE)))} />
                      <Select label="Temporal resolution" value="monthly" onChange={() => undefined}>
                        <option value="monthly">Monthly (from NASA POWER)</option>
                      </Select>
                    </div>
                    <div className="mt-6">
                      <div className="label-mono mb-2">Record coverage</div>
                      <div className="relative h-10 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-black/20">
                        {(() => {
                          const lo = 1978,
                            hi = THIS_YEAR_COMPLETE + 1;
                          const x = (y: number) => ((y - lo) / (hi - lo)) * 100;
                          return (
                            <>
                              <div className="absolute inset-y-2 rounded bg-[var(--color-cyan-soft)] ring-1 ring-[var(--color-cyan)]" style={{ left: `${x(startYear)}%`, width: `${x(endYear + 1) - x(startYear)}%` }} />
                              {[1980, 1990, 2000, 2010, 2020].map((y) => (
                                <span key={y} className="absolute -bottom-5 -translate-x-1/2 font-mono text-[10px] text-[var(--color-ink-4)]" style={{ left: `${x(y)}%` }}>
                                  {y}
                                </span>
                              ))}
                            </>
                          );
                        })()}
                      </div>
                      <div className="mt-8 grid gap-2">
                        {variableIds.map((id) => {
                          const v = getVariable(id)!;
                          return (
                            <div key={id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--color-line)] px-3 py-2 text-xs">
                              <span className="text-[var(--color-ink-2)]">{v.name}</span>
                              <span className="font-mono text-[var(--color-ink-3)]">{v.dataset.product} · {v.dataset.timeRange}</span>
                            </div>
                          );
                        })}
                      </div>
                      <p className="mt-4 text-sm text-[var(--color-ink-3)]">
                        <span className="num font-mono text-[var(--color-ink)]">{years}</span> years selected{minStart > 1981 ? ` · earliest available start for your variables: ${minStart}` : ""}.
                      </p>
                    </div>
                  </section>
                )}

                {step === 4 && (
                  <section aria-labelledby="s4">
                    <h2 id="s4" className="font-display text-2xl tracking-[-0.02em]">How should we test it?</h2>
                    <p className="mt-1 text-sm text-[var(--color-ink-3)]">All methods are computed; choose which appear and which one leads the summary.</p>
                    <div className="mt-6 grid gap-2">
                      {METHODS.map((m) => {
                        const on = methods.includes(m.id);
                        return (
                          <button key={m.id} aria-pressed={on} onClick={() => setMethods((ms) => (on ? ms.filter((x) => x !== m.id) : [...ms, m.id]))} className={cn("flex items-start gap-3 rounded-[var(--radius-md)] border p-3 text-left", on ? "border-[var(--color-cyan)] bg-[var(--color-cyan-soft)]" : "border-[var(--color-line)] hover:border-[var(--color-line-strong)]")}>
                            <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border", on ? "border-[var(--color-cyan)] bg-[var(--color-cyan)] text-[#021018]" : "border-[var(--color-line-bright)]")}>{on && <Check className="h-3 w-3" />}</span>
                            <span>
                              <span className="block text-sm">{m.label}</span>
                              <span className="block text-xs text-[var(--color-ink-3)]">{m.desc}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-6 flex flex-wrap items-end gap-6">
                      <div>
                        <div className="label-mono mb-2">Headline method</div>
                        <Segmented ariaLabel="Headline method" value={primary} onChange={setPrimaryLocal} options={[{ value: "mk-sen", label: "Mann-Kendall + Sen" }, { value: "ols-ar1", label: "Regression (AR1)" }]} />
                      </div>
                      <div>
                        <div className="label-mono mb-2">Significance level α</div>
                        <Segmented ariaLabel="Significance level" value={String(alpha)} onChange={(v) => setAlpha(+v)} options={[{ value: "0.1", label: "0.10" }, { value: "0.05", label: "0.05" }, { value: "0.01", label: "0.01" }]} />
                      </div>
                    </div>
                  </section>
                )}

                {step === 5 && (
                  <section aria-labelledby="s5">
                    <h2 id="s5" className="font-display text-2xl tracking-[-0.02em]">Review</h2>
                    <dl className="mt-6 grid gap-4 sm:grid-cols-2">
                      <ReviewItem k="Question" v={question || "— (will be generated)"} />
                      <ReviewItem k="Variables" v={variableIds.map((id) => getVariable(id)?.name).join(", ") || "—"} />
                      <ReviewItem k="Regions" v={regions.map((r) => r.name).join(", ") || "—"} />
                      <ReviewItem k="Period" v={`${startYear} – ${endYear} (${years} years, monthly)`} />
                      <ReviewItem k="Methods" v={methods.map((m) => METHODS.find((x) => x.id === m)?.label).join(", ")} />
                      <ReviewItem k="Headline · α" v={`${primary === "mk-sen" ? "Mann-Kendall + Sen's slope" : "OLS (AR1-adjusted)"} · α = ${alpha}`} />
                      <ReviewItem k="Data source" v={liveVars.length ? "NASA POWER API (MERRA-2 / CERES), fetched live; area-weighted mean of grid cells inside each region" : "—"} />
                    </dl>
                    <div className="mt-6 space-y-2">
                      {issues.map((i, k) => (
                        <div key={k} className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-xs", i.level === "error" ? "border-[rgb(255_107_125/.35)] bg-[rgb(255_107_125/.06)] text-[#ffc2ca]" : "border-[rgb(245_197_107/.3)] bg-[rgb(245_197_107/.05)] text-[var(--color-ink-2)]")}>
                          <CircleAlert className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", i.level === "error" ? "text-[var(--color-danger)]" : "text-[var(--color-warn)]")} />
                          {i.text}
                        </div>
                      ))}
                      {!issues.length && <div className="flex items-center gap-2 text-xs text-[var(--color-rise)]"><Check className="h-3.5 w-3.5" /> Ready — data availability checked.</div>}
                    </div>
                  </section>
                )}
              </motion.div>
            </AnimatePresence>

            <div className="mt-8 flex items-center justify-between border-t border-[var(--color-line)] pt-5">
              <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} disabled={step === 0 || playing} onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
              {step < STEPS.length - 1 ? (
                <Button variant="secondary" iconRight={<ArrowRight className="h-4 w-4" />} disabled={!canNext || playing} onClick={() => setStep((s) => s + 1)}>
                  Continue
                </Button>
              ) : (
                <Button variant="primary" size="lg" iconRight={<ArrowRight className="h-4 w-4" />} disabled={blocking || playing} onClick={() => launch()}>
                  Run investigation
                </Button>
              )}
            </div>
          </div>

          {/* Summary rail */}
          <aside className="space-y-4">
            <div className="panel p-5">
              <div className="label-mono mb-3">Case file</div>
              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-[11px] text-[var(--color-ink-4)]">Question</div>
                  <div className="text-[var(--color-ink-2)]">{question || "—"}</div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--color-ink-4)]">Variables</div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {variableIds.length ? variableIds.map((id) => <Badge key={id} tone={getVariable(id)?.connector.kind === "power" ? "cyan" : "neutral"}>{getVariable(id)?.shortName}</Badge>) : <span className="text-[var(--color-ink-4)]">—</span>}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--color-ink-4)]">Regions</div>
                  <div className="text-[var(--color-ink-2)]">{regions.map((r) => r.name).join(", ") || "—"}</div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--color-ink-4)]">Period</div>
                  <div className="num font-mono text-[var(--color-ink-2)]">{startYear}–{endYear}</div>
                </div>
              </div>
            </div>
            <AnimatePresence>
              {narration && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} key={narration} className="rounded-[var(--radius-lg)] border border-[rgb(56_225_255/.35)] bg-[rgb(56_225_255/.06)] p-5" aria-live="polite">
                  <div className="label-mono mb-2 flex items-center gap-2 text-[var(--color-cyan)]">
                    <Play className="h-3 w-3" /> Demo narration
                  </div>
                  <p className="text-sm leading-relaxed text-[var(--color-ink)]">{narration}</p>
                  {playing && (
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" variant="subtle" icon={<Pause className="h-3.5 w-3.5" />} onClick={stopDemo}>
                        Stop demo
                      </Button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </aside>
        </div>
      </div>
    </div>
  );
}

function ReviewItem({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] p-3">
      <dt className="label-mono mb-1">{k}</dt>
      <dd className="text-sm text-[var(--color-ink)]">{v}</dd>
    </div>
  );
}
