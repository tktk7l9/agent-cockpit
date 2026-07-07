import type { CockpitApi } from "../shared/ipc";

declare global {
  interface Window {
    cockpit: CockpitApi;
  }
}

export {};
