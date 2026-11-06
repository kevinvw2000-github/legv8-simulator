// Core simulator API. Pure and DOM-free.
import { parseValue } from './bits';
import { execute } from './execute';
import { instructionToString } from './isa';
import { ParseError, parseProgram, type Program } from './parser';
import { ExecError, MachineState, type Mode } from './state';

/** Register/memory values as signed-decimal strings, matching the zyBooks display. */
export interface Storage {
  registers: Record<string, string>;
  memory: Record<string, string>;
}

export type RunResult =
  | { kind: 'finished'; storage: Storage }
  | { kind: 'parseError'; message: string }
  | { kind: 'runtimeError'; message: string };

export interface RunOptions {
  /** Abort with the infinite-loop message after this many steps. */
  maxSteps?: number;
  /** 'zybooks' (default) reproduces the reference simulator's quirks; 'arm' is architecturally correct. */
  mode?: Mode;
}

export const INFINITE_LOOP_MESSAGE = 'Program end never reached (commonly due to an infinite loop).';

export class RuntimeError extends Error {
  constructor(
    message: string,
    /** Index of the instruction that failed. */
    readonly pc: number,
  ) {
    super(message);
    this.name = 'RuntimeError';
  }
}

/** A loaded program plus its machine state. Drives both tests and the UI. */
export class Machine {
  readonly state: MachineState;

  constructor(
    readonly program: Program,
    initial: Storage = { registers: {}, memory: {} },
    mode: Mode = 'zybooks',
  ) {
    this.state = new MachineState(mode);
    for (const [name, value] of Object.entries(initial.registers)) {
      this.state.writeReg(name, parseValue(value));
    }
    for (const [addr, value] of Object.entries(initial.memory)) {
      this.state.writeMem(parseValue(addr), 8, parseValue(value));
    }
    this.state.clearChanges();
  }

  get done(): boolean {
    return this.state.pc < 0 || this.state.pc >= this.program.instructions.length;
  }

  /** Execute one instruction. Throws RuntimeError with the zyBooks message format. */
  step(): void {
    if (this.done) return;
    const pc = this.state.pc;
    const ins = this.program.instructions[pc];
    if (!ins) return;
    this.state.clearChanges();
    try {
      this.state.pc = execute(ins, pc, this.state, this.program);
    } catch (e) {
      if (e instanceof ExecError) {
        throw new RuntimeError(`Error: ${instructionToString(ins)}. ${e.message}`, pc);
      }
      throw e;
    }
    this.state.steps++;
  }

  storage(): Storage {
    return {
      registers: Object.fromEntries(this.state.registerView().map((r) => [r.name, r.value])),
      memory: Object.fromEntries(this.state.memoryView().map((m) => [m.address, m.value])),
    };
  }
}

/** Parse and run a whole program to completion. */
export function runProgram(source: string, initial: Storage, options: RunOptions = {}): RunResult {
  let machine: Machine;
  try {
    machine = new Machine(parseProgram(source), initial, options.mode);
  } catch (e) {
    if (e instanceof ParseError) return { kind: 'parseError', message: e.display };
    throw e;
  }
  try {
    while (!machine.done) {
      if (options.maxSteps !== undefined && machine.state.steps >= options.maxSteps) {
        return { kind: 'runtimeError', message: INFINITE_LOOP_MESSAGE };
      }
      machine.step();
    }
  } catch (e) {
    if (e instanceof RuntimeError) return { kind: 'runtimeError', message: e.message };
    throw e;
  }
  return { kind: 'finished', storage: machine.storage() };
}
