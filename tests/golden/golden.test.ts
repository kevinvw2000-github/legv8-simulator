// Conformance tests: replay programs observed in the zyBooks simulator.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runProgram, type Storage } from '../../src/core/machine';

interface GoldenCase {
  name: string;
  /** Program text, or `sourceFile` naming a file next to the JSON. */
  source?: string;
  sourceFile?: string;
  initial: Storage;
  expected: {
    registers?: Record<string, string>;
    memory?: Record<string, string>;
    error?: null;
    parseError?: string;
    runtimeError?: string;
    ui?: string;
  };
}

const dir = __dirname;
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

for (const file of files) {
  const { cases } = JSON.parse(readFileSync(join(dir, file), 'utf8')) as { cases: GoldenCase[] };

  describe(file, () => {
    for (const c of cases) {
      // UI-only observations are covered by Playwright tests, not here.
      // Cases whose local-only source file is absent (e.g. a fresh clone) are skipped.
      const missing = c.sourceFile !== undefined && !existsSync(join(dir, c.sourceFile));
      const run = c.expected.ui || missing ? it.skip : it;
      run(c.name, () => {
        const source = c.sourceFile ? readFileSync(join(dir, c.sourceFile), 'utf8') : (c.source ?? '');
        const result = runProgram(source, c.initial, { maxSteps: 1_000_000 });
        if (c.expected.parseError !== undefined) {
          expect(result).toEqual({ kind: 'parseError', message: c.expected.parseError });
        } else if (c.expected.runtimeError !== undefined) {
          expect(result).toEqual({ kind: 'runtimeError', message: c.expected.runtimeError });
        } else {
          expect(result).toEqual({
            kind: 'finished',
            storage: { registers: c.expected.registers ?? {}, memory: c.expected.memory ?? {} },
          });
        }
      });
    }
  });
}
