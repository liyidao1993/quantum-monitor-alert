import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const outdir = path.join(projectRoot, "dist-alert");

await mkdir(outdir, { recursive: true });

await build({
  entryPoints: [path.join(projectRoot, "tools/binance-alert-daemon.ts")],
  outfile: path.join(outdir, "binance-alert-daemon.cjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: false,
  banner: {
    js: "/* Quantum Monitor Light Alert Daemon */",
  },
});

console.log("Built dist-alert/binance-alert-daemon.cjs");
