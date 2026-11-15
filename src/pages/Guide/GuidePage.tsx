import type { ReactNode } from "react";
import { ArrowRight, BrainCircuit, FileText, GitCompareArrows, Globe2, Network, Play, Sigma } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";

/* ==========================================================================
   How to use EARTHSCOPE — a short guide for first-time visitors.
   Screenshots in public/guide/ are real captures of the app.
   ========================================================================== */

function Shot({ src, alt, caption }: { src: string; alt: string; caption: string }) {
  return (
    <figure className="mt-5">
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-abyss)]">
        <img src={src} alt={alt} loading="lazy" className="block w-full" />
      </div>
      <figcaption className="mt-2 text-xs text-[var(--color-ink-3)]">{caption}</figcaption>
    </figure>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <section className="mt-14 border-t border-[var(--color-line)] pt-10" aria-labelledby={`step-${n}`}>
      <div className="label-mono text-[var(--color-cyan)]">Step {n}</div>
      <h2 id={`step-${n}`} className="mt-2 font-display text-[clamp(1.5rem,2.6vw,2.1rem)] leading-tight tracking-[-0.02em]">
        {title}
      </h2>
      <div className="mt-4 space-y-3 text-[15px] leading-relaxed text-[var(--color-ink-2)]">{children}</div>
    </section>
  );
}

const B = ({ children }: { children: ReactNode }) => <strong className="font-medium text-[var(--color-ink)]">{children}</strong>;

export default function GuidePage() {
  return (
    <div className="min-h-dvh pt-[var(--nav-h)]">
      <div className="container-x max-w-4xl py-14">
        <div className="label-mono mb-3 text-[var(--color-cyan)]">Guide for first-time visitors</div>
        <h1 className="font-display text-[clamp(2rem,4.4vw,3.4rem)] leading-[1.04] tracking-[-0.03em]">How to use EARTHSCOPE</h1>
        <p className="mt-4 text-lg leading-relaxed text-[var(--color-ink-2)]">
          EARTHSCOPE answers questions like <em className="not-italic text-[var(--color-ink)]">“Is it getting drier in Jordan?”</em> using 45 years of real NASA data — and tells you
          whether the change is real or could just be natural ups and downs. No science background needed. This guide takes about two minutes.
        </p>

        {/* Quick start */}
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {[
            { t: "Just looking?", d: "Open a finished case from the Home page — it loads instantly.", to: "/", cta: "Go to Home" },
            { t: "Want a tour?", d: "Watch a guided demo: EARTHSCOPE fills in every step for you.", to: "/investigate?demo=jordan-precip", cta: "Watch a demo" },
            { t: "Have a question?", d: "Ask your own question about any country or region.", to: "/investigate", cta: "Start investigating" },
          ].map((c) => (
            <div key={c.t} className="panel flex flex-col p-5">
              <div className="font-display text-lg">{c.t}</div>
              <p className="mt-1 flex-1 text-sm text-[var(--color-ink-3)]">{c.d}</p>
              <ButtonLink to={c.to} variant="secondary" size="sm" className="mt-4 self-start" iconRight={<ArrowRight className="h-3.5 w-3.5" />}>
                {c.cta}
              </ButtonLink>
            </div>
          ))}
        </div>

        <Step n="1" title="The fastest start: open a finished case">
          <p>
            On the <B>Home</B> page, just below the big headline, there are three cards such as <B>“How fast is the Arctic warming?”</B>. Click one and the full result opens
            straight away. The data are real NASA measurements, prepared in advance so nothing has to download.
          </p>
          <Shot src="/guide/home-cards.jpg" alt="Three finished-case cards on the Home page" caption="Home page: click any card to open a finished investigation." />
        </Step>

        <Step n="2" title="Ask your own question">
          <p>
            Press <B>Start Investigating</B> (top right). A short setup opens with six steps along the top. You can move between them at any time.
          </p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              <B>Question</B> — type a question in your own words, naming <em>what</em> and <em>where</em>: “Is precipitation decreasing in Jordan?”. EARTHSCOPE suggests a matching
              variable and place under <B>“EARTHSCOPE understood”</B> — <B>click each suggestion to add it</B>. Not sure what to ask? Click a topic such as Heat or Rain &amp; drought.
            </li>
            <li>
              <B>Variables</B> — the things to measure (temperature, rain, soil moisture, haze…). Each has a one-line explanation. Variables marked <B>live</B> are downloaded from NASA
              for you.
            </li>
            <li>
              <B>Region</B> — click a country on the map, search for a place, draw a box, or type coordinates. Add up to four places to compare them.
            </li>
            <li>
              <B>Time range</B> — the default (1981–2025, 45 years) is best: longer records can detect smaller changes.
            </li>
            <li>
              <B>Methods</B> — leave the defaults. All the tests run anyway; this only chooses which one leads the summary.
            </li>
            <li>
              <B>Review</B> — check the summary and press <B>Run investigation</B>. A progress bar shows the download from NASA (usually 5–30 seconds; repeat runs are instant).
            </li>
          </ol>
          <Shot src="/guide/wizard.jpg" alt="Setup step 1 with a typed question and suggestions" caption="Step 1: type the question, then click the suggested variable and place to add them." />
        </Step>

        <Step n="3" title="Read your result">
          <p>
            The result opens in the <B>Workspace</B>. Read it from the top of the right-hand card:
          </p>
          <ul className="space-y-2">
            <li>
              <B>The plain sentence</B> — the answer in one line, for example “Yearly rainfall… fell by about 1.90 mm/yr per decade, but this is not statistically significant”.
            </li>
            <li>
              <B>The big number</B> — how fast it is changing, per 10 years. <span className="text-[var(--color-rise)]">Green</span> means rising,{" "}
              <span className="text-[var(--color-fall)]">coral</span> means falling.
            </li>
            <li>
              <B>The bar under it (95% confidence interval)</B> — the range the true trend probably lies in. If the bar crosses the middle line (zero), the data can’t rule out
              “no change”.
            </li>
            <li>
              <B>p-value</B> — below <B>0.05</B> means the trend is <B>statistically significant</B> (very unlikely to be chance). Above 0.05: it could be natural variation.
            </li>
            <li>
              <B>Symbols</B> — ▲ rising and significant · ▼ falling and significant · △ ▽ ◇ hollow or dashed = not significant. Colour is never the only clue.
            </li>
          </ul>
          <p>
            In the middle you’ll find the <B>map</B> (the dots are the NASA grid cells that were averaged) and the <B>chart</B>, with three tabs: <B>Annual trend</B>,{" "}
            <B>Monthly</B> and <B>Anomalies</B> (each month compared with its normal value, so the seasons don’t hide the trend). Hover over the chart to read exact values.
          </p>
          <Shot src="/guide/workspace.jpg" alt="Workspace showing map, chart and result card for Jordan" caption="Workspace: study-area map, time series, and the result card with the plain sentence, trend, confidence bar and p-value." />
          <p className="rounded-[var(--radius-md)] border border-[var(--color-line)] p-4 text-sm">
            <B>“Not significant” is a real answer, not an error.</B> It means the change is small compared with natural year-to-year swings. EARTHSCOPE also tells you roughly how many
            years of data would be needed to detect it.
          </p>
        </Step>

        <Step n="4" title="Go further (optional)">
          <p>The bar under the top menu links every tool to your current investigation:</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { i: Sigma, t: "Trend Lab", d: "See how each statistical method reached its answer, and play with the significance simulator." },
              { i: GitCompareArrows, t: "Compare", d: "Add more places (up to four) and see their trends side by side on one axis." },
              { i: Network, t: "Relationships", d: "Check whether two variables move together, e.g. rainfall and soil moisture — remember: correlation is not causation." },
              { i: Globe2, t: "Earth Explorer", d: "A 3D globe of trends at 640 places. Drag to rotate, click a country to investigate it." },
              { i: BrainCircuit, t: "AI Scientist", d: "Ask questions about your results. It only uses your computed numbers and tells you when a question doesn’t match the data." },
              { i: FileText, t: "Report", d: "Create a printable scientific report and download the data (PDF, CSV, JSON)." },
            ].map(({ i: Icon, t, d }) => (
              <div key={t} className="flex gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] p-4">
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-cyan)]" />
                <div>
                  <div className="text-sm text-[var(--color-ink)]">{t}</div>
                  <div className="mt-0.5 text-[13px] text-[var(--color-ink-3)]">{d}</div>
                </div>
              </div>
            ))}
          </div>
          <Shot src="/guide/compare.jpg" alt="Regional comparison of Cameroon, DR Congo and Tanzania" caption="Compare: one plain sentence per region, then all trends with their confidence intervals on one axis." />
          <Shot src="/guide/ai.jpg" alt="AI Scientist explaining that a case does not contain precipitation" caption="AI Scientist: it refuses to answer a rainfall question with temperature data, and offers to add the right variable." />
        </Step>

        <section className="mt-14 border-t border-[var(--color-line)] pt-10" aria-labelledby="faq">
          <h2 id="faq" className="font-display text-2xl tracking-[-0.02em]">
            Common questions
          </h2>
          <dl className="mt-5 space-y-5 text-[15px]">
            {[
              ["Where does the data come from?", "From NASA: the POWER service (MERRA-2 and CERES, monthly, 1981–2025), NASA GIBS satellite imagery, GISTEMP, MODIS and the NSIDC Sea Ice Index. Each chart shows its source."],
              ["Is anything made up?", "No. Every number is calculated from real data. The only synthetic data is the significance simulator in the Trend Lab, which is clearly labelled “Simulation”."],
              ["What does ‘significant’ mean here?", "For one place: p below 0.05. For the 640 points on the globe: a stricter rule (false discovery rate q = 0.05) so that chance results aren’t counted."],
              ["Is my work saved?", "Yes, in this browser. Open “My workspace” at the top right to see past investigations and reports. There are no accounts."],
              ["It’s slow the first time.", "The first run downloads data for every grid cell from NASA. After that it is saved on your device and opens instantly."],
            ].map(([q, a]) => (
              <div key={q}>
                <dt className="text-[var(--color-ink)]">{q}</dt>
                <dd className="mt-1 text-[var(--color-ink-3)]">{a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="mt-14 flex flex-wrap gap-3">
          <ButtonLink to="/investigate" variant="primary" size="lg" iconRight={<ArrowRight className="h-4 w-4" />}>
            Start your investigation
          </ButtonLink>
          <ButtonLink to="/investigate?demo=jordan-precip" variant="secondary" size="lg" icon={<Play className="h-4 w-4" />}>
            Watch a demo first
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
