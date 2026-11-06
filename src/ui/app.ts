// Application controller: wires the editor, panels and run controls to the core Machine.

import { Machine, RuntimeError } from '../core/machine';
import { ParseError, parseProgram } from '../core/parser';
import type { Mode } from '../core/state';
import { exportWorkspace, importWorkspace } from '../core/stateIO';
import { createEditor, type CodeEditor } from './editor';
import { StoragePanel, type Entry } from './storagePanel';

export const SPEEDS = { Slow: 3000, Medium: 2000, Fast: 1000, Instant: 0 } as const;
export type Speed = keyof typeof SPEEDS;

interface Saved {
  code: string;
  registers: Entry[];
  memory: Entry[];
  speed: Speed;
  mode: Mode;
  /** 1-based source lines with a breakpoint. */
  breakpoints: number[];
}

const STORAGE_KEY = 'legv8-sim:v1';

const DEFAULT: Saved = {
  code: [
    '// Sum X19 doublewords starting at address X20; result in X0.',
    '// Change the inputs in the Registers and Memory panels.',
    'ADD X0, XZR, XZR      // sum = 0',
    'ADD X1, XZR, XZR      // i = 0',
    'Loop:',
    'SUBS XZR, X1, X19',
    'B.GE Done',
    'LSL X2, X1, #3        // byte offset = i * 8',
    'ADD X2, X20, X2',
    'LDUR X3, [X2, #0]',
    'ADD X0, X0, X3',
    'ADDI X1, X1, #1',
    'B Loop',
    'Done:',
  ].join('\n'),
  registers: [
    { key: 'X19', value: '3' },
    { key: 'X20', value: '4000' },
  ],
  memory: [
    { key: '4000', value: '5' },
    { key: '4008', value: '7' },
    { key: '4016', value: '9' },
  ],
  speed: 'Fast',
  mode: 'zybooks',
  breakpoints: [],
};

function load(): Saved {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT);
    const s = JSON.parse(raw) as Partial<Saved>;
    return {
      code: typeof s.code === 'string' ? s.code : DEFAULT.code,
      registers: Array.isArray(s.registers) ? s.registers : DEFAULT.registers,
      memory: Array.isArray(s.memory) ? s.memory : DEFAULT.memory,
      speed: s.speed && s.speed in SPEEDS ? s.speed : DEFAULT.speed,
      mode: s.mode === 'arm' ? 'arm' : 'zybooks',
      breakpoints: Array.isArray(s.breakpoints) ? s.breakpoints.filter(Number.isInteger) : [],
    };
  } catch {
    return structuredClone(DEFAULT);
  }
}

const $ = <T extends HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

export class App {
  private readonly editor: CodeEditor;
  private readonly registers: StoragePanel;
  private readonly memory: StoragePanel;
  private saved: Saved;

  private machine: Machine | null = null;
  private running = false;
  private timer: number | null = null;
  private stopped = false; // finished or errored
  private stopReason: 'finished' | 'error' = 'finished';
  /** Instruction indexes that carry a breakpoint (recomputed when breakpoints change). */
  private breakpointPcs = new Set<number>();
  /** True until the first instruction of a Run executes, so Run can leave a breakpoint. */
  private runJustStarted = false;

  private readonly els: {
    enter: HTMLButtonElement;
    exit: HTMLButtonElement;
    step: HTMLButtonElement;
    run: HTMLButtonElement;
    pause: HTMLButtonElement;
    speed: HTMLSelectElement;
    mode: HTMLSelectElement;
    clearBps: HTMLButtonElement;
    ioText: HTMLTextAreaElement;
    ioButtons: HTMLButtonElement[];
    console: HTMLElement;
    status: HTMLElement;
    flags: HTMLElement;
    pc: HTMLElement;
    steps: HTMLElement;
  };

  constructor(root: HTMLElement) {
    this.saved = load();
    root.innerHTML = TEMPLATE;
    this.els = {
      enter: $(root, '#enter'),
      exit: $(root, '#exit'),
      step: $(root, '#step'),
      run: $(root, '#run'),
      pause: $(root, '#pause'),
      speed: $(root, '#speed'),
      mode: $(root, '#mode'),
      clearBps: $(root, '#clear-bps'),
      ioText: $(root, '#io-text'),
      ioButtons: [...root.querySelectorAll<HTMLButtonElement>('.io button')],
      console: $(root, '#console'),
      status: $(root, '#status'),
      flags: $(root, '#flags'),
      pc: $(root, '#pc'),
      steps: $(root, '#steps'),
    };

    this.editor = createEditor(
      $(root, '#editor'),
      this.saved.code,
      (code) => {
        this.saved.code = code;
        this.editor.setErrorLine(null);
        this.save();
      },
      (lines) => {
        this.saved.breakpoints = lines;
        this.save();
        this.updateBreakpointPcs();
        this.els.clearBps.disabled = lines.length === 0;
      },
    );
    this.editor.setBreakpoints(this.saved.breakpoints);
    this.registers = new StoragePanel($(root, '#registers'), 'registers', (e) => {
      this.saved.registers = e;
      this.save();
    });
    this.memory = new StoragePanel($(root, '#memory'), 'memory', (e) => {
      this.saved.memory = e;
      this.save();
    });
    this.registers.setEntries(this.saved.registers);
    this.memory.setEntries(this.saved.memory);

    for (const name of Object.keys(SPEEDS)) this.els.speed.add(new Option(name, name));
    this.els.speed.value = this.saved.speed;
    this.els.mode.value = this.saved.mode;

    this.els.enter.addEventListener('click', () => this.enterSimulation());
    this.els.exit.addEventListener('click', () => this.exitSimulation());
    this.els.step.addEventListener('click', () => this.stepOnce());
    this.els.run.addEventListener('click', () => this.startRun());
    this.els.pause.addEventListener('click', () => this.pause());
    this.els.speed.addEventListener('change', () => {
      this.saved.speed = this.els.speed.value as Speed;
      this.save();
      if (this.running) {
        this.clearTimer();
        this.scheduleNext();
      }
    });
    this.els.mode.addEventListener('change', () => {
      this.saved.mode = this.els.mode.value as Mode;
      this.save();
    });
    this.els.clearBps.addEventListener('click', () => this.editor.clearBreakpoints());
    this.els.clearBps.disabled = this.saved.breakpoints.length === 0;
    document.addEventListener('keydown', (e) => this.onKey(e));

    $<HTMLButtonElement>(root, '#export').addEventListener('click', () => this.exportToText());
    $<HTMLButtonElement>(root, '#copy').addEventListener('click', () => void this.copyExport());
    confirmTwice($(root, '#import'), 'Replace code and values?', () => this.importFromText());
    confirmTwice($(root, '#reset'), 'Replace with the demo?', () => this.resetToDefault());

    this.render();
  }

  // ---------- import / export / reset ----------

  private exportToText(): void {
    const { code, registers, memory } = this.saved;
    this.els.ioText.value = exportWorkspace({ code, registers, memory });
    this.els.ioText.select();
    this.log('Exported. Paste this into zyBooks (More options → Import) or keep it to import later.', 'ok');
  }

  private async copyExport(): Promise<void> {
    if (!this.els.ioText.value) this.exportToText();
    try {
      await navigator.clipboard.writeText(this.els.ioText.value);
      this.log('Copied to clipboard.', 'ok');
    } catch {
      this.els.ioText.select();
      this.log('Clipboard unavailable. The text is selected; press Ctrl+C to copy.');
    }
  }

  private importFromText(): void {
    let ws;
    try {
      ws = importWorkspace(this.els.ioText.value);
    } catch (e) {
      this.log((e as Error).message, 'error');
      return;
    }
    this.applyWorkspace(ws);
    this.log('Imported.', 'ok');
  }

  private resetToDefault(): void {
    this.applyWorkspace(structuredClone({ code: DEFAULT.code, registers: DEFAULT.registers, memory: DEFAULT.memory }));
    this.log('Reset to the demo program.', 'ok');
  }

  private applyWorkspace(ws: { code?: string; registers?: Entry[]; memory?: Entry[] }): void {
    if (ws.code !== undefined) {
      this.editor.setCode(ws.code);
      this.editor.clearBreakpoints();
    }
    if (ws.registers) {
      this.saved.registers = ws.registers;
      this.registers.setEntries(ws.registers);
    }
    if (ws.memory) {
      this.saved.memory = ws.memory;
      this.memory.setEntries(ws.memory);
    }
    this.editor.setErrorLine(null);
    this.save();
    this.render();
  }

  // ---------- keyboard ----------

  /** F5 Run/Continue · F6 Pause · F10 Step · F9 toggle breakpoint · Ctrl+Enter enter/exit. */
  private onKey(e: KeyboardEvent): void {
    const sim = this.machine !== null;
    let handled = true;
    if (e.key === 'F5' && !e.ctrlKey) {
      if (sim) this.startRun();
      else this.enterSimulation();
    } else if (e.key === 'F6') this.pause();
    else if (e.key === 'F10') {
      if (sim) this.stepOnce();
      else this.enterSimulation();
    } else if (e.key === 'F9') this.editor.toggleBreakpointAtCursor();
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      if (sim) this.exitSimulation();
      else this.enterSimulation();
    } else handled = false;
    if (handled) e.preventDefault();
  }

  // ---------- breakpoints ----------

  /**
   * Map breakpoint lines to instruction indexes. A breakpoint on a blank, comment or
   * label line applies to the next instruction below it.
   */
  private updateBreakpointPcs(): void {
    this.breakpointPcs.clear();
    const instructions = this.machine?.program.instructions;
    if (!instructions) return;
    for (const line of this.saved.breakpoints) {
      const pc = instructions.findIndex((ins) => ins.line >= line);
      if (pc !== -1) this.breakpointPcs.add(pc);
    }
  }

  /** True when Run should stop before executing the current instruction. */
  private atBreakpoint(): boolean {
    const m = this.machine;
    if (!m || this.runJustStarted) return false;
    if (!this.breakpointPcs.has(m.state.pc)) return false;
    const line = m.program.instructions[m.state.pc]?.line;
    this.log(`Paused at breakpoint on line ${line}.`, 'ok');
    return true;
  }

  // ---------- lifecycle ----------

  private enterSimulation(): void {
    if (!this.registers.isValid() || !this.memory.isValid()) {
      this.log('Fix the highlighted register or memory values first.', 'error');
      return;
    }
    let program;
    try {
      program = parseProgram(this.editor.getCode());
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      this.log(e.display, 'error');
      this.editor.setErrorLine(e.line);
      return;
    }
    try {
      this.machine = new Machine(
        program,
        {
          registers: Object.fromEntries(this.saved.registers.map((r) => [r.key, r.value])),
          memory: Object.fromEntries(this.saved.memory.map((m) => [m.key, m.value])),
        },
        this.saved.mode,
      );
    } catch (e) {
      this.log(`Could not load initial values: ${(e as Error).message}`, 'error');
      return;
    }
    this.stopped = false;
    this.editor.setErrorLine(null);
    this.editor.setEditable(false);
    this.updateBreakpointPcs();
    this.log('');
    this.render();
  }

  private exitSimulation(): void {
    this.pause();
    this.machine = null;
    this.stopped = false;
    this.editor.setEditable(true);
    this.editor.setCurrentLine(null);
    this.editor.setErrorLine(null);
    this.log('');
    this.render();
  }

  /** Execute one instruction. Returns false when execution can't continue. */
  private advance(): boolean {
    const m = this.machine;
    if (!m || this.stopped) return false;
    try {
      m.step();
    } catch (e) {
      if (!(e instanceof RuntimeError)) throw e;
      this.stopped = true;
      this.stopReason = 'error';
      this.log(e.message, 'error');
      this.editor.setErrorLine(m.program.instructions[e.pc]?.line ?? null);
      return false;
    }
    if (m.done) {
      this.stopped = true;
      this.stopReason = 'finished';
      this.log(`Program finished after ${m.state.steps} step${m.state.steps === 1 ? '' : 's'}.`, 'ok');
      return false;
    }
    return true;
  }

  private stepOnce(): void {
    if (this.running) return;
    this.advance();
    this.render();
  }

  private startRun(): void {
    if (!this.machine || this.stopped || this.running) return;
    this.running = true;
    this.runJustStarted = true;
    this.log('');
    this.render();
    this.scheduleNext();
  }

  /** One Run step: stop at a breakpoint, otherwise execute. Returns false to stop running. */
  private runStep(): boolean {
    if (this.atBreakpoint()) return false;
    this.runJustStarted = false;
    return this.advance();
  }

  private pause(): void {
    this.clearTimer();
    if (this.running) {
      this.running = false;
      this.render();
    }
  }

  private scheduleNext(): void {
    const delay = SPEEDS[this.saved.speed];
    if (delay === 0) {
      this.timer = requestAnimationFrame(() => this.runBatch());
    } else {
      // The first step of a Run happens immediately; later ones wait `delay`.
      this.timer = window.setTimeout(() => {
        const more = this.runStep();
        this.render();
        if (more && this.running) this.scheduleNext();
        else this.finishRun();
      }, this.runJustStarted ? 0 : delay);
    }
  }

  /** Instant speed: run as many steps as fit in ~12 ms, then repaint. */
  private runBatch(): void {
    const deadline = performance.now() + 12;
    let more = true;
    while (more && this.running && performance.now() < deadline) {
      for (let i = 0; i < 500 && more; i++) more = this.runStep();
    }
    this.render();
    if (more && this.running) this.scheduleNext();
    else this.finishRun();
  }

  private finishRun(): void {
    this.timer = null;
    this.running = false;
    this.render();
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    cancelAnimationFrame(this.timer);
    this.timer = null;
  }

  // ---------- rendering ----------

  private render(): void {
    const m = this.machine;
    const sim = m !== null;
    const { enter, exit, step, run, pause, speed, mode, status } = this.els;

    enter.hidden = sim;
    exit.hidden = !sim;
    run.hidden = this.running;
    pause.hidden = !this.running;
    step.disabled = !sim || this.running || this.stopped;
    run.disabled = !sim || this.stopped;
    mode.disabled = sim;
    speed.disabled = false;
    for (const b of this.els.ioButtons) b.disabled = sim;

    const state = !sim ? 'editing' : this.running ? 'running' : this.stopped ? this.stopReason : 'paused';
    document.body.dataset.state = state;
    status.textContent = { editing: 'Editing', running: 'Running', paused: 'Paused', finished: 'Finished', error: 'Error' }[state];

    if (!m) {
      this.registers.showEditing();
      this.memory.showEditing();
      this.els.flags.replaceChildren(...flagChips(null));
      this.els.pc.textContent = '—';
      this.els.steps.textContent = '0';
      return;
    }

    const st = m.state;
    this.registers.showSimulation(st.registerView().map((r) => ({ key: r.name, value: r.value, changed: r.changed })));
    this.memory.showSimulation(st.memoryView().map((r) => ({ key: r.address, value: r.value, changed: r.changed })));
    this.els.flags.replaceChildren(...flagChips(st.flags));
    this.els.pc.textContent = m.done ? 'end' : String(st.pc * 4);
    this.els.steps.textContent = String(st.steps);
    this.editor.setCurrentLine(m.done || this.stopped ? null : (m.program.instructions[st.pc]?.line ?? null));
  }

  private log(text: string, tone: 'ok' | 'error' | '' = ''): void {
    this.els.console.textContent = text;
    this.els.console.dataset.tone = tone;
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.saved));
    } catch {
      // Storage unavailable (private mode etc.): keep working without persistence.
    }
  }
}

/** A destructive button: the first click asks for confirmation, the second (within 4 s) acts. */
function confirmTwice(button: HTMLButtonElement, prompt: string, action: () => void): void {
  const label = button.textContent ?? '';
  let timer: number | undefined;
  const disarm = () => {
    window.clearTimeout(timer);
    delete button.dataset.armed;
    button.textContent = label;
  };
  button.addEventListener('click', () => {
    if (button.dataset.armed) {
      disarm();
      action();
      return;
    }
    button.dataset.armed = 'true';
    button.textContent = prompt;
    timer = window.setTimeout(disarm, 4000);
  });
  button.addEventListener('blur', disarm);
}

function flagChips(flags: { N: boolean; Z: boolean; C: boolean; V: boolean } | null): HTMLElement[] {
  return (['N', 'Z', 'C', 'V'] as const).map((f) => {
    const chip = document.createElement('span');
    chip.className = 'flag';
    const on = flags?.[f] ?? false;
    chip.dataset.on = String(on);
    chip.textContent = `${f} ${on ? 1 : 0}`;
    chip.title = { N: 'Negative', Z: 'Zero', C: 'Carry', V: 'Overflow' }[f];
    return chip;
  });
}

const TEMPLATE = `
<header class="topbar">
  <h1>LEGv8 Simulator</h1>
  <label class="mode">Semantics
    <select id="mode" title="zyBooks reproduces the zyBooks simulator exactly, including its quirks">
      <option value="zybooks">zyBooks-compatible</option>
      <option value="arm">ARM-accurate</option>
    </select>
  </label>
</header>
<main class="layout">
  <section class="code-pane" aria-label="Assembly">
    <div class="toolbar" role="toolbar" aria-label="Simulation controls">
      <button id="enter" type="button" class="primary">Enter simulation</button>
      <button id="exit" type="button" class="secondary" hidden>Exit simulation</button>
      <span class="divider" aria-hidden="true"></span>
      <button id="step" type="button" disabled>Step</button>
      <button id="run" type="button" disabled>Run</button>
      <button id="pause" type="button" hidden>Pause</button>
      <label class="speed">Speed <select id="speed"></select></label>
      <button id="clear-bps" type="button" class="ghost" title="Remove all breakpoints">Clear breakpoints</button>
      <span id="status" class="status" role="status">Editing</span>
    </div>
    <div id="editor" class="editor"></div>
    <p class="hint">Click a line number to toggle a breakpoint.
      <kbd>F5</kbd> Run/Continue · <kbd>F6</kbd> Pause · <kbd>F10</kbd> Step · <kbd>F9</kbd> Breakpoint · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> Enter/Exit</p>
    <output id="console" class="console" aria-live="polite"></output>
  </section>
  <aside class="side-pane">
    <section class="panel" aria-labelledby="regs-title">
      <h2 id="regs-title">Registers</h2>
      <div id="registers" class="storage"></div>
    </section>
    <section class="panel" aria-labelledby="mem-title">
      <h2 id="mem-title">Memory</h2>
      <div id="memory" class="storage"></div>
    </section>
    <section class="panel cpu" aria-label="CPU state">
      <div class="cpu-row"><span class="cpu-label">Flags</span><span id="flags" class="flags"></span></div>
      <div class="cpu-row"><span class="cpu-label">PC</span><span id="pc" class="mono">—</span></div>
      <div class="cpu-row"><span class="cpu-label">Steps</span><span id="steps" class="mono">0</span></div>
    </section>
    <details class="panel io">
      <summary>Import / Export</summary>
      <p class="io-note">Uses the zyBooks simulator's format, so text exported here can be imported there and vice versa.</p>
      <textarea id="io-text" rows="4" spellcheck="false" aria-label="Import or export text"></textarea>
      <div class="io-actions">
        <button id="export" type="button">Export</button>
        <button id="copy" type="button">Copy</button>
        <button id="import" type="button">Import</button>
        <button id="reset" type="button" class="ghost danger">Reset to demo</button>
      </div>
    </details>
  </aside>
</main>`;
