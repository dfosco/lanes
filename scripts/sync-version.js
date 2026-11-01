import { readFile, writeFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
await writeFile(
  new URL('../src/version.js', import.meta.url),
  `export const version = '${packageJson.version}';\n`,
);
