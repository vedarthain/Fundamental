/**
 * RowSparkline — the tiny inline price chart shown per scanner row.
 *
 * Colored by net direction over the window (green up / red down), baseline
 * hidden (it's clutter at this size). Pass `floor` to overlay a dashed support
 * level (used by the At-Support scanner so the row shows price relative to the
 * floor it's sitting on). Renders a muted "—" when there isn't enough history.
 */
import { Sparkline, type SparkPoint } from "@/components/Sparkline";

const GREEN = "var(--color-delta-up, #0a0)";
const RED = "var(--color-delta-down, #b00)";

export function RowSparkline({
  series,
  floor,
  showHiLo = false,
  width = 96,
  height = 30,
}: {
  series?: SparkPoint[];
  floor?: number | null;
  /** Overlay dotted high/low rules at the window's extremes (see Sparkline). */
  showHiLo?: boolean;
  width?: number;
  height?: number;
}) {
  const pts = (series ?? []).filter((p) => p.value != null) as { label: string; value: number }[];
  if (pts.length < 2) {
    return <span className="muted-text text-[11px] tabular-nums">—</span>;
  }
  const first = pts[0].value;
  const last = pts[pts.length - 1].value;
  const color = last >= first ? GREEN : RED;
  const overlay =
    floor != null ? (series ?? []).map((p) => ({ label: p.label, value: floor })) : undefined;
  return (
    <Sparkline
      data={series ?? []}
      overlay={overlay}
      width={width}
      height={height}
      stroke={color}
      showBaseline={false}
      showHiLo={showHiLo}
    />
  );
}
