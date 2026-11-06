# zyBooks compatibility notes

This simulator aims to match the **observable behavior** of the zyBooks LEGv8 simulator: the same register and
memory results, and the same error messages. These notes describe what that simulator does from a user's point
of view, as observed by running programs in it. They are the spec for the default *zyBooks-compatible* mode.

## Language

- **47 instructions**, in seven formats:

  | Format | Mnemonics | Syntax | Constant range |
  |---|---|---|---|
  | R | ADD ADDS SUB SUBS AND ORR EOR MUL SDIV | `OP Xd, Xn, Xm` | none |
  | I | ADDI ADDIS SUBI SUBIS ANDI ORRI EORI LSL LSR | `OP Xd, Xn, #imm` | −1024 … 1023 |
  | D | LDUR LDURB LDURH LDURSW STUR STURB STURH STURW | `OP Xt, [Xn, #off]` (the offset is required) | −256 … 255 |
  | B | B, B.EQ B.NE B.HS B.LO B.MI B.PL B.VS B.VC B.HI B.LS B.GE B.LT B.GT B.LE, BL | `OP label` | label must exist |
  | CB | CBZ CBNZ | `OP Xt, label` | label must exist |
  | BR | BR | `BR Xn` | none |
  | IM | MOVZ MOVK | `OP Xd, imm, LSL shift` (no `#`) | −32768 … 32767; shift 0, 16, 32 or 48 |

- Mnemonics and registers are **uppercase only**. Registers are `X0`–`X30` and `XZR`; there are no `SP`, `FP` or
  `LR` aliases. `X31` and above are rejected.
- Numbers are signed decimal. There are no hex literals.
- `//` starts a comment. `#` is only the immediate marker.
- Labels end in `:`, can stand alone or precede an instruction on the same line, and refer to the next instruction.
  A label after the last instruction refers to the end of the program.

## Parse errors

Shown as `Line N: <message>`, with the line marked, when entering simulation. The whole program is checked first.

| Situation | Message |
|---|---|
| Unrecognized characters | `Unrecognized syntax near: <rest of line>` |
| Line starts with something other than a label or mnemonic | `Unexpected text: <token>` |
| Unknown mnemonic | `Unrecognized op code: <word>` |
| Operands in the wrong shape | `Instruction has an error.` |
| Register not allowed (e.g. `X31`) | `<name> is not a valid register name` |
| Constant out of range | `<n> is out of range. Valid range: <lo> to <hi>` |
| MOVZ/MOVK shift keyword | `<x> must be 'LSL'` / `<n> must be 0, 16, 32, or 48.` |
| Label defined twice | `Same label as on line N. A label should be defined only once.` |
| Label never defined | `Label is undefined: <name>` |
| No instructions | `Enter assembly to simulate.` |

## Machine state

- Registers are 64 bits. Values are displayed in **signed decimal**.
- Memory is byte-addressed and **little-endian**, from 0 to 2^62 − 1, with **no alignment checks**. The panel
  groups bytes into 8-byte doublewords.
- The panels list only registers and memory that the program has **read or written** (plus `XZR`). Reading a
  never-used address makes it appear with value 0.
- Writes to `XZR` are ignored.
- Instructions occupy 4 bytes starting at address 0, so `BL` on instruction *i* sets `X30 = (i + 1) × 4`, and
  `BR Xn` jumps to instruction `Xn / 4`. A `BR` past the end ends the program.

## Runtime errors

Shown as `Error: <instruction>. <message>`, for example `Error: SDIV X1, X2, XZR. division by zero`.

| Situation | Message |
|---|---|
| Division by zero | `division by zero` |
| Address outside memory | `Invalid address: <address as unsigned>` |
| `BR` to an address that isn't a multiple of 4 | `Instruction addresses should be word-aligned. Tried to access: <n>` |

The zyBooks interface has no step limit; an infinite loop runs until paused. `runProgram()` here accepts a
`maxSteps` option and reports `Program end never reached (commonly due to an infinite loop).`

## Quirks

These differ from real ARM hardware. The zyBooks-compatible mode reproduces them; ARM-accurate mode doesn't.

1. **Flags are computed after the destination is written** (ADDS, SUBS, ADDIS, SUBIS), from the source
   registers' new values. `SUBS X0, X0, X1` with X0 = X1 = 5 leaves Z clear, because it effectively compares
   the new X0 (0) with X1 (5).
2. **SUBIS carry** behaves like a signed comparison against the immediate. `SUBIS XZR, X1, #1` with X1 = −1
   leaves C clear (real ARM sets it), and a negative immediate always sets C.
3. **SDIV** behaves as if bits 32–39 of each operand were cleared. Values from 0 to 2^32 − 1 are unaffected,
   but −7 / 2 gives −547608330243 instead of −3.
4. **MOVZ/MOVK** sign-extend a negative immediate before shifting.

Both modes keep only the low 6 bits of a shift amount (`LSL #64` acts like `#0`).

## Interactive checks

Each of these was run in the zyBooks simulator on 2026-11-05 and is replayed by
`tests/golden/zybooks-probes-2026-11-05.json`.

| # | Checks | Program (abridged) | zyBooks result | Real ARM |
|---|---|---|---|---|
| P1 | SDIV quirk | X1 = −7, X2 = 2, `SDIV X3, X1, X2` | X3 = −547608330243 | −3 |
| P2 | Flags after write | X0 = X1 = 5, `SUBS X0, X0, X1`, `B.EQ` | not taken | taken |
| P3 | SUBIS carry | X1 = −1, `SUBIS XZR, X1, #1`, `B.HS` | not taken | taken |
| P4 | Reads appear in the panel | `LDUR X1, [XZR, #200]` | memory shows `200 0` | n/a |
| P5 | BL return address | `BL f` on the first line | X30 = 4 | n/a |
| P6 | Runtime error format | `SDIV X1, X2, XZR` | `Error: SDIV X1, X2, XZR. division by zero` | n/a |
| P7 | MOVZ range | `MOVZ X1, 32768, LSL 0` | `Line 1: 32768 is out of range. Valid range: -32768 to 32767` | n/a |
| P8 | No step limit | two-instruction infinite loop | runs until paused | n/a |

## Import/export format

```json
{"code":"ADD X1, X2, X3","registers":"X2 5, X3 4","memory":"4000 30, 4008 1"}
```

`registers` and `memory` are `name value` pairs joined by `, `, with memory as doublewords. Errors:
`Import string could not be parsed. Perhaps try exporting again.`, `Registers format or naming invalid.` and
`Memory format or naming invalid.`
