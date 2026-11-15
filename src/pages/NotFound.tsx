import { ButtonLink } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="flex min-h-[80dvh] items-center justify-center px-6 pt-[var(--nav-h)]">
      <div className="text-center">
        <div className="label-mono mb-4 text-[var(--color-cyan)]">Signal lost · 404</div>
        <h1 className="display-xl text-[clamp(3rem,9vw,7rem)]">Off the map.</h1>
        <p className="mx-auto mt-5 max-w-md text-[var(--color-ink-3)]">This coordinate isn't part of EARTHSCOPE. Head back to orbit or start a new investigation.</p>
        <div className="mt-8 flex justify-center gap-3">
          <ButtonLink to="/" variant="secondary">
            Back to home
          </ButtonLink>
          <ButtonLink to="/investigate" variant="primary">
            Start investigating
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
