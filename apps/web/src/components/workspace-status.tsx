"use client";

import { useWorkspace } from "../state/workspace-provider";

export function WorkspaceStatus() {
  const { connection, executionStatus, error, result } = useWorkspace();
  const loading = ["connecting", "disconnecting"].includes(connection.status)
    || ["planning", "executing"].includes(executionStatus);
  const tone = error ? "error" : loading ? "loading" : executionStatus === "clarification-required"
    ? "clarify" : connection.status === "connected" ? "connected" : "demo";
  const label = error ? "Error" : loading ? "Loading" : executionStatus === "clarification-required"
    ? "Needs clarification" : connection.status === "connected"
      ? result?.source === "postgres" ? "Connected · query complete" : "Connected"
      : "Demo · sample data";
  return <span className={`status-pill status-${tone}`} role="status"><span className="status-dot" />{label}</span>;
}
