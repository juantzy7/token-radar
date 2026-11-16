/*
Snapshot in, model it into a board, then write `board.json`, `data.js`, copy the
dashboard assets, and emit `dossier.json` for the packaged offline deliverable.
*/

import { mkdirSync, cpSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoard, CATEGORY_NOTES } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_INPUT_PATH = '/input/snapshot.json';
const DEFAULT_OUTPUT_DIR = '/output';
const DOSSIER_TEXT_MAX_BYTES = 65_536;

function parseInputPath(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error('Bad input: missing value for --input');
      }
      return resolve(value);
    }
  }
  return DEFAULT_INPUT_PATH;
}

function resolveOutputDir() {
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR;
  if (outputDir === undefined || outputDir === '') {
    return DEFAULT_OUTPUT_DIR;
  }
  return resolve(outputDir);
}

function readSnapshot(inputPath) {
  if (!existsSync(inputPath)) {
    throw new Error(`Missing input file: ${inputPath}`);
  }

  let text;
  try {
    text = readFileSync(inputPath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read input file ${inputPath}: ${message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Bad input JSON in ${inputPath}: ${message}`);
  }

  return parsed;
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function copyTreeIntoOutput(sourceName, outputDir) {
  const sourcePath = join(__dirname, sourceName);
  if (!existsSync(sourcePath)) {
    throw new Error(`Missing required directory: ${sourcePath}`);
  }
  cpSync(sourcePath, join(outputDir, sourceName), { recursive: true, force: true });
}

function writeStableJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function buildDataJs(rows, stats) {
  const payload = {
    rows,
    stats,
    categoryNotes: CATEGORY_NOTES,
  };
  return `window.RADAR_DATA = ${JSON.stringify(payload)};\n`;
}

function coveredWatchlistCount(rows) {
  let count = 0;
  for (const row of rows) {
    if (row.on_watchlist) count += 1;
  }
  return count;
}

function main() {
  const inputPath = parseInputPath(process.argv.slice(2));
  const outputDir = resolveOutputDir();
  const snapshot = readSnapshot(inputPath);
  const board = buildBoard(snapshot);

  ensureDir(outputDir);

  writeStableJson(join(outputDir, 'board.json'), {
    rows: board.rows,
    stats: board.stats,
  });

  writeFileSync(join(outputDir, 'data.js'), buildDataJs(board.rows, board.stats), 'utf8');

  copyTreeIntoOutput('dashboard', outputDir);
  copyTreeIntoOutput('screenshots', outputDir);

  const dossierBytes = buildDossier(outputDir, { text_max_bytes: DOSSIER_TEXT_MAX_BYTES });
  writeFileSync(join(outputDir, 'dossier.json'), dossierBytes);

  const watchlistCovered = coveredWatchlistCount(board.rows);
  console.log(`${board.rows.length} rows, ${watchlistCovered} watchlist slugs covered, $${board.stats.totalImpliedUsd} total implied value`);
}

main();
