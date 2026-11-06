// CodeMirror 6 editor with LEGv8 highlighting, a current-line marker and an error-line marker.

import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import {
  Compartment,
  EditorState,
  RangeSet,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  GutterMarker,
  gutter,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type DecorationSet,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { MNEMONIC_FORMAT } from '../core/isa';

// ---------- syntax highlighting ----------

const legv8 = StreamLanguage.define<null>({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/^\w+:/)) return 'labelName';
    if (stream.match(/^X(\d{1,2}|ZR)\b/)) return 'variableName';
    if (stream.match(/^#?-?\d+/)) return 'number';
    const word = stream.match(/^(\w|\.)+/) as RegExpMatchArray | null;
    if (word) return Object.hasOwn(MNEMONIC_FORMAT, word[0]) ? 'keyword' : 'name';
    stream.next();
    return null;
  },
  tokenTable: {},
});

const highlight = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: tags.keyword, color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: tags.labelName, color: 'var(--syn-label)' },
  { tag: tags.variableName, color: 'var(--syn-register)' },
  { tag: tags.number, color: 'var(--syn-number)' },
  { tag: tags.name, color: 'var(--syn-label)' },
]);

// ---------- line markers ----------

type Marks = { current: number | null; error: number | null };

const setMarks = StateEffect.define<Partial<Marks>>();

const currentLineDeco = Decoration.line({ class: 'cm-sim-current' });
const errorLineDeco = Decoration.line({ class: 'cm-sim-error' });

const marksField = StateField.define<{ marks: Marks; decos: DecorationSet }>({
  create: () => ({ marks: { current: null, error: null }, decos: Decoration.none }),
  update(value, tr) {
    let marks = value.marks;
    for (const e of tr.effects) if (e.is(setMarks)) marks = { ...marks, ...e.value };
    if (marks === value.marks && !tr.docChanged) return value;
    const doc = tr.state.doc;
    const ranges = [];
    const valid = (n: number | null): n is number => n !== null && n >= 1 && n <= doc.lines;
    // Decorations must be added in document order.
    const entries: Array<[number, Decoration]> = [];
    if (valid(marks.current)) entries.push([marks.current, currentLineDeco]);
    if (valid(marks.error)) entries.push([marks.error, errorLineDeco]);
    entries.sort((a, b) => a[0] - b[0]);
    for (const [n, deco] of entries) ranges.push(deco.range(doc.line(n).from));
    return { marks, decos: Decoration.set(ranges, true) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
});

// ---------- breakpoints ----------

/** Toggle the breakpoint on the line starting at `pos`; `on` forces a state. */
const toggleBreakpoint = StateEffect.define<{ pos: number; on?: boolean }>({
  map: (v, mapping) => ({ ...v, pos: mapping.mapPos(v.pos) }),
});
const clearBreakpoints = StateEffect.define<null>();

class BreakpointMarker extends GutterMarker {
  override toDOM() {
    const dot = document.createElement('span');
    dot.className = 'cm-bp-dot';
    dot.setAttribute('aria-hidden', 'true');
    return dot;
  }
}
const breakpointMarker = new BreakpointMarker();

/** Sizes the gutter without rendering a (hidden) dot of its own. */
class SpacerMarker extends GutterMarker {
  override toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-bp-spacer';
    return s;
  }
}

const breakpointField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(clearBreakpoints)) set = RangeSet.empty;
      if (!e.is(toggleBreakpoint)) continue;
      // Treat any marker on the line as that line's breakpoint (edits can shift markers).
      const line = tr.state.doc.lineAt(e.value.pos);
      let has = false;
      set.between(line.from, line.to, () => {
        has = true;
      });
      const on = e.value.on ?? !has;
      if (on && !has) set = set.update({ add: [breakpointMarker.range(line.from)] });
      if (!on && has) set = set.update({ filter: (from) => from < line.from || from > line.to });
    }
    return set;
  },
});

function toggleAt(view: EditorView, linePos: number): boolean {
  view.dispatch({ effects: toggleBreakpoint.of({ pos: view.state.doc.lineAt(linePos).from }) });
  return true;
}

function breakpointLines(state: EditorState): number[] {
  const lines = new Set<number>();
  const iter = state.field(breakpointField).iter();
  for (; iter.value; iter.next()) lines.add(state.doc.lineAt(iter.from).number);
  return [...lines].sort((a, b) => a - b);
}

const breakpointGutter = [
  breakpointField,
  gutter({
    class: 'cm-bp-gutter',
    markers: (v) => v.state.field(breakpointField),
    initialSpacer: () => new SpacerMarker(),
    domEventHandlers: {
      mousedown: (view, line) => toggleAt(view, line.from),
    },
  }),
];

// ---------- editor API ----------

export interface CodeEditor {
  view: EditorView;
  getCode(): string;
  setCode(code: string): void;
  setEditable(editable: boolean): void;
  /** Highlight the line about to execute (1-based), or clear with null. */
  setCurrentLine(line: number | null): void;
  /** Highlight a line with an error (1-based), or clear with null. */
  setErrorLine(line: number | null): void;
  /** 1-based lines that have a breakpoint, ascending. */
  getBreakpoints(): number[];
  setBreakpoints(lines: number[]): void;
  /** Toggle the breakpoint on the line holding the cursor. */
  toggleBreakpointAtCursor(): void;
  clearBreakpoints(): void;
}

export function createEditor(
  parent: HTMLElement,
  doc: string,
  onChange: (code: string) => void,
  onBreakpointsChange: (lines: number[]) => void = () => {},
  extra: Extension[] = [],
): CodeEditor {
  const editable = new Compartment();

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        breakpointGutter,
        lineNumbers({
          domEventHandlers: { mousedown: (view, line) => toggleAt(view, line.from) },
        }),
        history(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        legv8,
        syntaxHighlighting(highlight),
        marksField,
        editable.of([EditorView.editable.of(true), EditorState.readOnly.of(false)]),
        EditorView.contentAttributes.of({ 'aria-label': 'Assembly code editor' }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange(u.state.doc.toString());
          const before = u.startState.field(breakpointField);
          const after = u.state.field(breakpointField);
          if (before !== after) onBreakpointsChange(breakpointLines(u.state));
        }),
        ...extra,
      ],
    }),
  });

  const scrollToLine = (line: number) => {
    if (line < 1 || line > view.state.doc.lines) return;
    view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(line).from, { y: 'nearest' }) });
  };

  return {
    view,
    getCode: () => view.state.doc.toString(),
    setCode: (code) =>
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } }),
    setEditable: (on) =>
      view.dispatch({
        effects: editable.reconfigure([EditorView.editable.of(on), EditorState.readOnly.of(!on)]),
      }),
    setCurrentLine: (line) => {
      view.dispatch({ effects: setMarks.of({ current: line }) });
      if (line !== null) scrollToLine(line);
    },
    setErrorLine: (line) => {
      view.dispatch({ effects: setMarks.of({ error: line }) });
      if (line !== null) scrollToLine(line);
    },
    getBreakpoints: () => breakpointLines(view.state),
    setBreakpoints: (lines) => {
      const doc = view.state.doc;
      view.dispatch({
        effects: [
          clearBreakpoints.of(null),
          ...lines
            .filter((n) => Number.isInteger(n) && n >= 1 && n <= doc.lines)
            .map((n) => toggleBreakpoint.of({ pos: doc.line(n).from, on: true })),
        ],
      });
    },
    toggleBreakpointAtCursor: () => {
      toggleAt(view, view.state.selection.main.head);
    },
    clearBreakpoints: () => view.dispatch({ effects: clearBreakpoints.of(null) }),
  };
}
