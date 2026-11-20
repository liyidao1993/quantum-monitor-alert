import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface DaemonState {
  telegram_update_offset: number;
  last_ranking_broadcast_at: number;
}

const defaultState: DaemonState = {
  telegram_update_offset: 0,
  last_ranking_broadcast_at: 0,
};

export class StateStore {
  private state: DaemonState = { ...defaultState };
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly statePath = path.resolve(process.cwd(), ".runtime/alert-daemon/state.json")) {}

  async load(): Promise<DaemonState> {
    try {
      const raw = await readFile(this.statePath, "utf8");
      this.state = { ...defaultState, ...(JSON.parse(raw) as Partial<DaemonState>) };
    } catch {
      this.state = { ...defaultState };
    }
    return this.state;
  }

  get(): DaemonState {
    return this.state;
  }

  async update(mutator: (state: DaemonState) => DaemonState): Promise<DaemonState> {
    this.state = mutator(this.state);
    const snapshot = `${JSON.stringify(this.state, null, 2)}\n`;
    const task = this.writeChain.then(async () => {
      await mkdir(path.dirname(this.statePath), { recursive: true });
      const tmpPath = `${this.statePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
      await writeFile(tmpPath, snapshot, "utf8");
      await rename(tmpPath, this.statePath);
    });
    this.writeChain = task.catch(() => undefined);
    await task;
    return this.state;
  }
}
