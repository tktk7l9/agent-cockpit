// The only bridge between renderer and main. No generic ipcRenderer passthrough.

import { contextBridge, ipcRenderer } from "electron";
import type { Mutation } from "../lib/mutations";
import { CHANNELS, type BaseHashes, type CockpitApi } from "../shared/ipc";

const api: CockpitApi = {
  scan: () => ipcRenderer.invoke(CHANNELS.scan),
  preview: (mutation: Mutation) => ipcRenderer.invoke(CHANNELS.preview, mutation),
  apply: (mutation: Mutation, baseHashes: BaseHashes) => ipcRenderer.invoke(CHANNELS.apply, mutation, baseHashes),
  addProject: () => ipcRenderer.invoke(CHANNELS.addProject),
  removeProject: (path: string) => ipcRenderer.invoke(CHANNELS.removeProject, path),
  listBackups: () => ipcRenderer.invoke(CHANNELS.listBackups),
  previewRestore: (id: string) => ipcRenderer.invoke(CHANNELS.previewRestore, id),
  applyRestore: (id: string, baseHash: string | null) => ipcRenderer.invoke(CHANNELS.applyRestore, id, baseHash),
  reveal: (path: string) => ipcRenderer.invoke(CHANNELS.reveal, path),
  onChanged: (callback: () => void) => {
    const listener = (): void => callback();
    ipcRenderer.on(CHANNELS.changed, listener);
    return () => ipcRenderer.removeListener(CHANNELS.changed, listener);
  },
};

contextBridge.exposeInMainWorld("cockpit", api);
