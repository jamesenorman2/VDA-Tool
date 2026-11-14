// Vercel build step: writes config.js from environment variables, so site-wide settings (such as
// the MapTiler key) are set once in Vercel and reach every device. Run: node scripts/write-config.mjs
import { writeFileSync } from 'node:fs';

export function configSource(env) {
  const config = { maptilerKey: (env.MAPTILER_KEY || '').trim() };
  return `// Written at deploy time by scripts/write-config.mjs. Do not edit; set values in Vercel.\nwindow.VDA_CONFIG = ${JSON.stringify(config)};\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(new URL('../config.js', import.meta.url), configSource(process.env));
  console.log(`config.js written (MapTiler key ${process.env.MAPTILER_KEY ? 'set' : 'not set'})`);
}
