import { useNavigate } from "react-router";
import { Compass, Play, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/ui/States";
import { Button, ButtonLink } from "@/components/ui/Button";
import { useInvestigation } from "@/store/investigation";
import { DEMOS } from "@/data/demos";

/** Empty state shown on analysis pages when nothing has been computed yet. */
export function NoInvestigation({ title = "No active investigation", body }: { title?: string; body?: string }) {
  const config = useInvestigation((s) => s.config);
  const run = useInvestigation((s) => s.run);
  const navigate = useNavigate();
  return (
    <EmptyState
      icon={<Compass className="h-6 w-6" />}
      title={config ? "Your last investigation needs to be re-run" : title}
      body={
        config
          ? `“${config.question}” — data are cached locally, so re-running is quick.`
          : (body ?? "Ask a question about a variable and a region, or watch one of the guided demonstrations. Every number you see is computed from real NASA data.")
      }
      action={
        <>
          {config && (
            <Button variant="primary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void run(config)}>
              Re-run investigation
            </Button>
          )}
          <ButtonLink to="/investigate" variant={config ? "secondary" : "primary"}>
            Start an investigation
          </ButtonLink>
          <Button variant="secondary" icon={<Play className="h-4 w-4" />} onClick={() => navigate(`/investigate?demo=${DEMOS[0].id}`)}>
            Watch a demo
          </Button>
        </>
      }
    />
  );
}
