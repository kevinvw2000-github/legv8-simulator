import { decodeShare, encodeShare, isShareHash, ShareLinkError, type SharedWorkspace } from '../../src/core/share';

const WS: SharedWorkspace = {
  code: 'ADDI X1, XZR, #5 // café ✓\nLoop:\nB Loop',
  registers: [{ key: 'X28', value: '8000' }],
  memory: [{ key: '4000', value: '-7' }],
  watches: [{ label: 'array', address: '4000', count: 3 }],
  breakpoints: [2],
  mode: 'arm',
};

describe('share links', () => {
  it('round-trips a workspace, including non-ASCII text', async () => {
    const hash = await encodeShare(WS);
    expect(isShareHash(hash)).toBe(true);
    expect(hash).toMatch(/^#s1=[A-Za-z0-9_-]+$/);
    expect(await decodeShare(hash)).toEqual(WS);
  });

  it('compresses typical programs into short links', async () => {
    const code = Array.from({ length: 60 }, (_, i) => `ADDI X${i % 28}, X${(i + 1) % 28}, #${i}  // step ${i}`).join('\n');
    const hash = await encodeShare({ ...WS, code });
    expect(hash.length).toBeLessThan(code.length / 2);
  });

  it('rejects a link that was cut off', async () => {
    const hash = await encodeShare(WS);
    await expect(decodeShare(hash.slice(0, hash.length - 10))).rejects.toBeInstanceOf(ShareLinkError);
    await expect(decodeShare('#s1=not*base64')).rejects.toBeInstanceOf(ShareLinkError);
  });

  it('drops malformed fields', async () => {
    const hash = await encodeShare({
      code: 'B x',
      registers: [{ key: 'X1' }, { key: 'X2', value: '3' }],
      watches: [{ label: 'bad', address: '4004', count: 1 }],
      breakpoints: [1, -2, 1.5, 'x'],
      mode: 'weird',
    } as never);
    expect(await decodeShare(hash)).toEqual({
      code: 'B x',
      registers: [{ key: 'X2', value: '3' }],
      memory: [],
      watches: [],
      breakpoints: [1],
      mode: 'zybooks',
    });
  });
});
