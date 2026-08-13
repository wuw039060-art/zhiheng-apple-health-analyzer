import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = path.join(projectRoot, 'package.json');
const cargoPath = path.join(projectRoot, 'src-tauri', 'Cargo.toml');

if (!fs.existsSync(packagePath) || !fs.existsSync(cargoPath)) {
  throw new Error(`Refusing to clean an unrecognized project root: ${projectRoot}`);
}

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const currentVersionMarker = `_${packageJson.version}_`;
const relativeDirectories = [
  '.bundle-mirror',
  '.cargo-local',
  '.npm-cache',
  '.rustup-local',
  '.toolchains',
  'dist',
  'node_modules',
  path.join('src-tauri', 'gen'),
  path.join('src-tauri', 'target'),
];

const targets = relativeDirectories
  .map((relativePath) => path.join(projectRoot, relativePath))
  .filter((target) => fs.existsSync(target));

for (const name of fs.readdirSync(projectRoot)) {
  if (name.endsWith('.tsbuildinfo')) {
    targets.push(path.join(projectRoot, name));
  }
}

const releaseDirectory = path.join(projectRoot, 'release');
if (fs.existsSync(releaseDirectory)) {
  const releaseNames = fs.readdirSync(releaseDirectory);
  const hasCurrentInstaller = releaseNames.some(
    (name) => name.endsWith('.exe') && name.includes(currentVersionMarker),
  );

  for (const name of releaseNames) {
    if (hasCurrentInstaller && name.endsWith('.exe') && !name.includes(currentVersionMarker)) {
      targets.push(path.join(releaseDirectory, name));
    }
  }
}

for (const target of targets) {
  const relative = path.relative(projectRoot, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to clean a path outside the project: ${target}`);
  }
}

if (targets.length === 0) {
  console.log('Workspace is already clean.');
  process.exit(0);
}

for (const target of targets.sort()) {
  const kind = fs.statSync(target).isDirectory() ? 'directory' : 'file';
  console.log(`[${kind}] ${target}`);
}

if (!process.argv.includes('--apply')) {
  console.log('Preview only. Re-run with --apply to remove these generated or superseded files.');
  process.exit(0);
}

for (const target of targets.sort((left, right) => right.length - left.length)) {
  fs.rmSync(target, { force: true, recursive: true, maxRetries: 3, retryDelay: 200 });
}

console.log(`Removed ${targets.length} generated or superseded workspace items.`);
