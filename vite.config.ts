/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  base: './',
  // The app shows this in its top bar; bump "version" in package.json for each release.
  define: { __APP_VERSION__: JSON.stringify(version) },
  test: {
    globals: true,
    include: ['tests/unit/**/*.test.ts', 'tests/golden/**/*.test.ts'],
  },
});
