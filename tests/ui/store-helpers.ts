import { useStore } from "../../src/renderer/src/store";
import type { ScanResultPayload } from "../../src/shared/ipc";
import { cockpit } from "./cockpit-mock";

export function resetStore(): void {
  useStore.setState({ ...useStore.getInitialState(), section: "mcp", agentFilter: "all" }, true);
}

/** Puts scan data straight into the store, as if refresh() had completed; later rescans return the same data. */
export function loadData(data: ScanResultPayload): void {
  cockpit().scan.mockResolvedValue(data);
  useStore.setState({ data, loading: false, stale: false });
}
