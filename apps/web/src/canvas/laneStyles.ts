import type { CanvasLane } from "@t3tools/contracts";

export const LANE_STYLES: Record<CanvasLane, { readonly label: string; readonly color: string }> = {
  frontend: { label: "Frontend", color: "#60a5fa" },
  backend: { label: "Backend", color: "#a78bfa" },
  infra: { label: "Infra", color: "#f59e0b" },
  external: { label: "External", color: "#34d399" },
};
