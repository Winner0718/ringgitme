import { access, copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const webDir = path.join(projectRoot, 'www');
const sourceIndex = path.join(projectRoot, 'index.html');

const excludedSegments = new Set([
  '.git',
  'node_modules',
  'work',
  'worker-audit',
  'ios',
  '.vite',
  'secrets',
]);

const references = new Set();
const skipped = new Set();

function normalizeLocalReference(rawReference) {
  if (!rawReference) return null;
  let value = rawReference.trim();
  if (
    !value ||
    value.includes('${') ||
    value.startsWith('#') ||
    value.startsWith('//') ||
    /^(?:[a-z][a-z\d+.-]*:)/i.test(value)
  ) return null;

  value = value.split(/[?#]/, 1)[0].replace(/^\.\//, '');
  if (!value || value.startsWith('/')) return null;
  if (!/^[A-Za-z0-9_./@+%-]+$/.test(value)) return null;

  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
  const segments = normalized.split('/');
  const sensitive = segments.some(segment =>
    excludedSegments.has(segment) ||
    segment === '..' ||
    segment === '.env' ||
    segment.startsWith('.env.') ||
    /secret/i.test(segment)
  );
  if (sensitive) {
    skipped.add(normalized);
    return null;
  }
  return normalized;
}

function addReference(rawReference) {
  const normalized = normalizeLocalReference(rawReference);
  if (normalized) references.add(normalized);
}

function collectReferences(source) {
  for (const match of source.matchAll(/<(?:link|script|img|source|video|audio)\b[^>]*\b(?:src|href|poster)\s*=\s*["']([^"'<>]+)["'][^>]*>/gi)) {
    addReference(match[1]);
  }
  for (const match of source.matchAll(/url\(\s*["']?((?:\.\/)?[A-Za-z0-9_./@+%-]+\.(?:avif|gif|jpe?g|png|svg|webp|woff2?|ttf|otf|mp3|wav))["']?\s*\)/gi)) {
    addReference(match[1]);
  }
  for (const match of source.matchAll(/["'`](assets\/[A-Za-z0-9_./@+%-]+)["'`]/g)) {
    addReference(match[1]);
  }
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

if (webDir !== path.resolve(projectRoot, 'www')) {
  throw new Error(`Refusing to clean unexpected webDir: ${webDir}`);
}

const indexSource = await readFile(sourceIndex, 'utf8');
collectReferences(indexSource);

if (references.has('manifest.json')) {
  const manifestPath = path.join(projectRoot, 'manifest.json');
  if (await exists(manifestPath)) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    for (const icon of Array.isArray(manifest.icons) ? manifest.icons : []) {
      addReference(icon && icon.src);
    }
  }
}

await rm(webDir, { recursive: true, force: true });
await mkdir(webDir, { recursive: true });
await copyFile(sourceIndex, path.join(webDir, 'index.html'));

const copied = ['index.html'];
const missing = [];

for (const relativePath of [...references].sort()) {
  if (relativePath === 'index.html') continue;
  const sourcePath = path.join(projectRoot, relativePath);
  if (!(await exists(sourcePath)) || !(await stat(sourcePath)).isFile()) {
    missing.push(relativePath);
    continue;
  }
  const destinationPath = path.join(webDir, relativePath);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await copyFile(sourcePath, destinationPath);
  copied.push(relativePath);
}

console.log(`[web:prepare] Recreated ${path.relative(projectRoot, webDir)}/ from root index.html.`);
console.log(`[web:prepare] Copied ${copied.length} file(s):`);
for (const file of copied) console.log(`  - ${file}`);

if (missing.length) {
  console.warn(`[web:prepare] Missing referenced local assets (${missing.length}); existing UI fallbacks remain in use:`);
  for (const file of missing) console.warn(`  - ${file}`);
}
if (skipped.size) {
  console.warn(`[web:prepare] Skipped excluded or sensitive references (${skipped.size}):`);
  for (const file of [...skipped].sort()) console.warn(`  - ${file}`);
}
