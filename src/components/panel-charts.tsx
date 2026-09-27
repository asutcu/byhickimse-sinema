"use client";

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";

const CHART_COLORS = {
  primary: "var(--color-chart-1)",
  accent: "var(--color-chart-2)",
  muted: "var(--color-chart-3)",
  warning: "var(--color-chart-4)",
  danger: "var(--color-chart-5)",
  success: "var(--color-success)",
};

type TooltipPayload = { name?: string; value?: number; color?: string };

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[10px] border border-border bg-surface px-3 py-2 shadow-sm">
      {label ? <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-2">{label}</div> : null}
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 text-[12px]">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: entry.color }} />
          <span className="text-muted">{entry.name}</span>
          <span className="ml-auto font-semibold tabular-nums">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

export function ClipOutcomeChart({
  completed,
  failed,
  className,
}: {
  completed: number;
  failed: number;
  className?: string;
}) {
  const data = [
    { name: "Tamamlanan", value: completed, color: CHART_COLORS.success },
    { name: "Basarisiz", value: failed, color: CHART_COLORS.danger },
  ].filter((d) => d.value > 0);

  const empty = completed + failed === 0;
  const chartData = empty ? [{ name: "Veri yok", value: 1, color: "var(--color-surface-4)" }] : data;

  return (
    <div className={cn("h-[200px] w-full", className)}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={52}
            outerRadius={78}
            paddingAngle={empty ? 0 : 3}
            stroke="var(--color-surface)"
            strokeWidth={2}
          >
            {chartData.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Pie>
          {!empty && <Tooltip content={<ChartTooltip />} />}
        </PieChart>
      </ResponsiveContainer>
      <div className="mt-1 flex justify-center gap-4 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-success" /> Tamamlanan {completed}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-danger" /> Basarisiz {failed}
        </span>
      </div>
    </div>
  );
}

export function TemplateMixChart({
  longform,
  narrator,
  className,
}: {
  longform: number;
  narrator: number;
  className?: string;
}) {
  const data = [
    { name: "Gorsel", count: longform, fill: CHART_COLORS.accent },
    { name: "Sinema", count: narrator, fill: CHART_COLORS.primary },
  ];

  return (
    <div className={cn("h-[200px] w-full", className)}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
          <XAxis
            dataKey="name"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--color-muted)", fontSize: 11 }}
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--color-muted-2)", fontSize: 11 }}
            width={28}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--color-surface-3)" }} />
          <Bar dataKey="count" name="Anlati" radius={[8, 8, 4, 4]} maxBarSize={48}>
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
