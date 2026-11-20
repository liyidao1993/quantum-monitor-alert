import { readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { AppSettings } from '../../4_Shared_Types/standard_models/marketTypes.js';

const coreEngineDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultSettingsPath = path.join(coreEngineDir, 'settings.json');

export class ConfigManager {
  private writeChain = Promise.resolve();

  constructor(private readonly settingsPath = defaultSettingsPath) {}

  async load(): Promise<AppSettings> {
    const raw = await readFile(this.settingsPath, 'utf8');
    return JSON.parse(raw) as AppSettings;
  }

  async save(settings: AppSettings): Promise<void> {
    const payload = `${JSON.stringify(settings, null, 2)}\n`;
    const writeTask = this.writeChain.then(async () => {
      const tempPath = `${this.settingsPath}.${Date.now()}.tmp`;
      await writeFile(tempPath, payload, 'utf8');
      await rename(tempPath, this.settingsPath);
    });
    this.writeChain = writeTask.catch(() => undefined);
    await writeTask;
  }

  async update(mutator: (settings: AppSettings) => AppSettings): Promise<AppSettings> {
    const current = await this.load();
    const next = mutator(current);
    await this.save(next);
    return next;
  }
}
