# LEGv8 Simulator

A browser-based simulator for the LEGv8 teaching subset of ARMv8, with a debugger-style interface. It runs
programs the same way as the zyBooks LEGv8 simulator, producing the same register and memory results and the
same error messages. An optional ARM-accurate mode fixes zyBooks' known quirks.

This is an independent project. It isn't affiliated with or endorsed by zyBooks, Wiley, Elsevier or Arm.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck and build static files into `dist/`, which can be hosted on any static web host |
| `npm run preview` | Serve the built `dist/` locally (it needs a web server; opening the file directly won't run) |
| `npm test` | Unit and conformance tests (Vitest) |
| `npm run test:e2e` | Browser tests (Playwright; first run `npx playwright install chromium`) |
| `npm run typecheck` | TypeScript only |

## Using it

1. Write assembly in the editor. Set starting values in **Registers** and **Memory** with **+ Add**.
2. **Enter simulation** checks the whole program. A parse error is shown with its line marked.
3. **Step** runs one instruction. **Run** runs at the chosen speed (Slow 3 s, Medium 2 s, Fast 1 s, Instant)
   until the program ends, an error occurs, you press **Pause**, or a breakpoint is reached.
4. **Step back** undoes the last instruction, up to the last 10,000 steps. It also works after the program finishes
   or stops with an error, so you can back up to just before the problem and step through it again.
5. Click a **line number** to toggle a breakpoint. Run stops *before* that line; Run again continues.
   A breakpoint on a blank, comment or label line stops at the next instruction.
6. **Exit simulation** returns to editing with your starting values restored.

During simulation the panels show only the registers and memory the program has read or written, as zyBooks does.
Values that just changed are highlighted, and the flags (N Z C V), PC (byte address) and step count are shown.
**Show values as** switches the register and memory values between signed decimal (the zyBooks default), unsigned
decimal, hex and binary; hex also applies to the PC. Hover over any value to see all four. Starting values are
still entered in decimal, and Import/Export always uses decimal.

**Keyboard:** <kbd>F5</kbd> Run/Continue · <kbd>F6</kbd> Pause · <kbd>F10</kbd> Step · <kbd>Ctrl</kbd>+<kbd>Z</kbd> Step back (while simulating) ·
<kbd>F9</kbd> toggle breakpoint · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> Enter/Exit simulation.

**Import / Export** uses the zyBooks simulator's text format, so you can move a program and its starting values
between the two (zyBooks: *More options → Export / Import*, where an activity offers it). The format was built from
the zyBooks simulator's behavior but hasn't yet been tried in a live zyBooks activity:

```json
{"code":"ADD X1, X2, X3","registers":"X2 5, X3 4","memory":"4000 30, 4008 1"}
```

Your code, starting values, breakpoints, speed and mode are saved in this browser only.

## Language

- **Instructions (47):** ADD ADDS ADDI ADDIS AND ANDI B B.EQ B.NE B.HS B.LO B.MI B.PL B.VS B.VC B.HI B.LS
  B.GE B.LT B.GT B.LE BL BR CBZ CBNZ EOR EORI LDUR LDURB LDURH LDURSW LSL LSR MOVK MOVZ MUL ORR ORRI SDIV
  STUR STURB STURH STURW SUB SUBI SUBIS SUBS
- **Registers:** `X0`–`X30`, `XZR`. Uppercase only; there are no `SP`/`LR` aliases. `BL` writes `X30`.
- **Syntax:**
  - `OP Xd, Xn, Xm`
  - `OP Xd, Xn, #imm` (also LSL/LSR)
  - `OP Xt, [Xn, #off]` (the offset is required)
  - `OP label`
  - `CBZ Xt, label`
  - `BR Xn`
  - `MOVZ Xd, imm, LSL 0|16|32|48` (no `#`)
- **Ranges:** I-format immediates and shift amounts −1024…1023; load/store offsets −256…255; MOVZ/MOVK −32768…32767.
- **Comments:** `//` to the end of the line. Labels end in `:` and may share a line with an instruction.
- **Memory:** byte-addressed and little-endian, from 0 to 2^62−1, with no alignment checks. Values are shown as signed decimal doublewords.
- **BL/BR:** instructions occupy 4 bytes from address 0, so `BL` on instruction *i* sets `X30 = (i + 1) × 4`.

## zyBooks compatibility

The default **zyBooks-compatible** mode reproduces these behaviors of the zyBooks simulator, each confirmed against it
(details in [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)).
**ARM-accurate** mode (Semantics menu) gives real hardware results instead.

| Behavior | zyBooks-compatible | ARM-accurate |
|---|---|---|
| `ADDS`/`SUBS`/`ADDIS`/`SUBIS` flags | Computed *after* Rd is written, from the re-read sources (e.g. `SUBS X0, X0, X1` uses the new X0) | From the original operands |
| `SUBIS` carry | Signed-style comparison against the immediate | Unsigned borrow |
| `SDIV` | Ignores bits 32–39 of both operands (−7 / 2 = −547608330243) | Correct signed division |
| `MOVK`/`MOVZ` with a negative immediate | Sign-extended before shifting | Low 16 bits only |

Behaviors shared by both modes:
- Reading memory or a register makes it appear in the panel.
- Writes to `XZR` are ignored.
- Shift amounts use only their low 6 bits.
- Out-of-range addresses report `Invalid address: <unsigned value>`.
- Runtime errors read `Error: <instruction>. <message>`.

Two deliberate interface differences:
- After a runtime error, the registers and memory stay visible (zyBooks resets them).
- The interface has no step limit. Run continues until you press Pause. `runProgram()` accepts a `maxSteps` option.

## Project layout

```
src/core/   parser, instruction table, execution, machine state, import/export (no DOM)
src/ui/     editor (CodeMirror 6), register/memory panels, app controller
tests/unit/     per-feature tests
tests/golden/   conformance cases recorded from the zyBooks simulator
tests/e2e/      Playwright interface tests
docs/COMPATIBILITY.md   the zyBooks behaviors this simulator reproduces
```

### Conformance tests

Each JSON file in `tests/golden/` holds programs and the results the zyBooks simulator produced for them. The
test runner replays every case. To add one, run a program in zyBooks, record the registers, memory or error it
shows, and add a case:

```json
{ "name": "my-case", "source": "ADDI X1, XZR, #5",
  "initial": { "registers": {}, "memory": {} },
  "expected": { "registers": { "X1": "5", "XZR": "0" }, "memory": {}, "error": null } }
```

Cases can use `"sourceFile"` instead of `"source"`. Cases whose source file is missing are skipped. Files named
`*.local.*` (for example `my-lab.local.json` and `my-lab.local.s`) are gitignored, so you can keep conformance
cases built from graded coursework on your own machine without publishing them.

## Deploying

`npm run build` produces a static site in `dist/` that any static host can serve. The included workflow
[.github/workflows/deploy.yml](.github/workflows/deploy.yml) runs the tests, builds, and publishes to GitHub Pages
on every push to `main`. To turn it on, set **Settings → Pages → Source** to **GitHub Actions** in the repository.

## License

[MIT](LICENSE). zyBooks is a trademark of its owner and is named here only to describe compatibility.
