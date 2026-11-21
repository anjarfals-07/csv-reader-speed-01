import { setFlagsFromString } from 'node:v8';
setFlagsFromString('--no-incremental-marking');

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { run } from './solve.js';

const inputDir = process.env.MAKEFUN_INPUT_DIR || '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

const cases = JSON.parse(readFileSync(`${inputDir}/cases.json`, 'utf8'));
const answers = cases.map((c: any) => run(c.input));

mkdirSync(outputDir, { recursive: true });
writeFileSync(`${outputDir}/answers.json`, JSON.stringify(answers));
