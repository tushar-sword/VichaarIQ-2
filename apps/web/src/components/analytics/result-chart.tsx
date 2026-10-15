"use client";

import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { compactNumber, formatValue, humanize } from "../../lib/analytics";
import type { ChartType, VisualizationResult } from "../../lib/visualization";

const COLORS = ["#3b6df2", "#79a0f5", "#3153a6", "#80b7ad", "#62778c", "#a1aed5", "#467f9d", "#b8caed"];

export function ResultChart({ data, type, xKey, yKey, sample }: {
  data: VisualizationResult; type: ChartType; xKey: string; yKey: string; sample: boolean;
}) {
  // 📌 REAL DATABASE: numeric strings are converted only for plotting; table values stay intact.
  const rows = data.rows.map((row) => ({ ...row, [yKey]: row[yKey] == null ? null : Number(row[yKey]) }));
  const tooltip = <Tooltip formatter={(value) => [formatValue(value), humanize(yKey)]}
    contentStyle={{ border: "1px solid #e4e8f0", borderRadius: 12, boxShadow: "0 8px 28px #18274414", fontSize: 12 }}
    labelStyle={{ color: "#697386", marginBottom: 5 }} />;
  const axes = <><CartesianGrid stroke="#edf0f5" vertical={false} />
    <XAxis dataKey={xKey} tickLine={false} axisLine={false} tick={{ fill: "#637087", fontSize: 12 }} tickMargin={14}
      minTickGap={24} label={{ value: humanize(xKey), position: "insideBottom", offset: -16, fill: "#637087", fontSize: 11 }} />
    <YAxis tickLine={false} axisLine={false} tick={{ fill: "#637087", fontSize: 12 }} tickFormatter={compactNumber}
      width={66} label={{ value: humanize(yKey), angle: -90, position: "insideLeft", fill: "#637087", fontSize: 11 }} />
    {tooltip}<Legend verticalAlign="top" align="right" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingBottom: 24 }} />
  </>;
  return <div className="chart-container" role="img" aria-label={`${sample ? "Sample " : "Query result "}${type} chart: ${humanize(yKey)} by ${humanize(xKey)}. Values are also available in the data table.`}>
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      {type === "pie" ? <PieChart>{tooltip}<Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }}
        formatter={(value) => <span style={{ color: "#526179" }}>{String(value)}</span>} />
        <Pie data={rows} dataKey={yKey} nameKey={xKey} innerRadius="48%" outerRadius="75%" paddingAngle={2}>
          {rows.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
        </Pie></PieChart>
        : type === "line" ? <LineChart data={rows} margin={{ top: 16, right: 24, bottom: 30, left: 12 }}>{axes}
          <Line type="monotone" dataKey={yKey} name={humanize(yKey)} stroke={COLORS[0]} strokeWidth={3}
            dot={{ r: 3, fill: "white", strokeWidth: 2 }} activeDot={{ r: 6 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
        : <BarChart data={rows} margin={{ top: 16, right: 24, bottom: 30, left: 12 }}>{axes}
          <Bar dataKey={yKey} name={humanize(yKey)} fill={COLORS[0]} radius={[5, 5, 0, 0]} maxBarSize={56} isAnimationActive={false} />
        </BarChart>}
    </ResponsiveContainer>
  </div>;
}
