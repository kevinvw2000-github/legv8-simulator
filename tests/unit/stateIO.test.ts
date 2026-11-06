import {
  IMPORT_PARSE_ERROR,
  MEMORY_FORMAT_ERROR,
  REGISTERS_FORMAT_ERROR,
  exportWorkspace,
  importWorkspace,
} from '../../src/core/stateIO';

describe('export', () => {
  it('matches the zyBooks format', () => {
    const text = exportWorkspace({
      code: 'ADD X1, X2, X3\nB end',
      registers: [
        { key: 'X2', value: '5' },
        { key: 'X3', value: '-4' },
      ],
      memory: [
        { key: '4000', value: '30' },
        { key: '4008', value: '1' },
      ],
    });
    expect(text).toBe(
      '{"code":"ADD X1, X2, X3\\nB end","registers":"X2 5, X3 -4","memory":"4000 30, 4008 1"}',
    );
  });

  it('writes empty strings when nothing is set', () => {
    expect(exportWorkspace({ code: '', registers: [], memory: [] })).toBe('{"code":"","registers":"","memory":""}');
  });
});

describe('import', () => {
  it('round-trips an export', () => {
    const ws = {
      code: 'LDUR X1, [X2, #0]',
      registers: [{ key: 'X2', value: '4000' }],
      memory: [{ key: '4000', value: '-9223372036854775808' }],
    };
    expect(importWorkspace(exportWorkspace(ws))).toEqual(ws);
  });

  it('accepts flexible spacing and drops XZR', () => {
    expect(importWorkspace('{"registers":"X1  7,X2 8, XZR 3"}')).toEqual({
      registers: [
        { key: 'X1', value: '7' },
        { key: 'X2', value: '8' },
      ],
    });
  });

  it('only replaces fields that are present as strings', () => {
    expect(importWorkspace('{"code":"ADD X1, X1, X1"}')).toEqual({ code: 'ADD X1, X1, X1' });
    expect(importWorkspace('{"memory":""}')).toEqual({ memory: [] });
  });

  it('accepts unsigned 64-bit values', () => {
    expect(importWorkspace('{"registers":"X1 18446744073709551615"}').registers).toEqual([
      { key: 'X1', value: '18446744073709551615' },
    ]);
  });

  it.each([
    ['not JSON', 'hello', IMPORT_PARSE_ERROR],
    ['JSON but not an object', '42', IMPORT_PARSE_ERROR],
    ['unknown register', '{"registers":"X31 1"}', REGISTERS_FORMAT_ERROR],
    ['lowercase register', '{"registers":"x1 1"}', REGISTERS_FORMAT_ERROR],
    ['non-numeric register value', '{"registers":"X1 abc"}', REGISTERS_FORMAT_ERROR],
    ['missing register value', '{"registers":"X1"}', REGISTERS_FORMAT_ERROR],
    ['register value too big', '{"registers":"X1 18446744073709551616"}', REGISTERS_FORMAT_ERROR],
    ['negative address', '{"memory":"-8 1"}', MEMORY_FORMAT_ERROR],
    ['address too large', `{"memory":"${1n << 62n} 1"}`, MEMORY_FORMAT_ERROR],
    ['non-numeric memory value', '{"memory":"4000 x"}', MEMORY_FORMAT_ERROR],
  ])('rejects %s', (_name, text, message) => {
    expect(() => importWorkspace(text)).toThrow(message);
  });
});
