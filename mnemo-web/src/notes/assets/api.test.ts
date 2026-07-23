import { describe, expect, it } from 'vitest';

import { noteAssetRequestPath } from './api';

describe('noteAssetRequestPath', () => {
  it('routes a managed id to the asset endpoint', () => {
    expect(noteAssetRequestPath('abc123.png')).toBe('/api/notes/assets/abc123.png');
  });

  it('routes a legacy attachment reference by its bare guid', () => {
    expect(noteAssetRequestPath('attachment:cafe01:diagram.png')).toBe('/api/notes/assets/cafe01');
    expect(noteAssetRequestPath('attachment:cafe01')).toBe('/api/notes/assets/cafe01');
    expect(noteAssetRequestPath('attachment:')).toBeNull();
  });

  it('routes a desktop-era absolute path through the containment-checked legacy route', () => {
    expect(noteAssetRequestPath('C:\\Users\\x\\AppData\\Local\\Mnemo\\images\\b.png')).toBe(
      `/api/notes/assets/legacy?path=${encodeURIComponent('C:\\Users\\x\\AppData\\Local\\Mnemo\\images\\b.png')}`,
    );
    expect(noteAssetRequestPath('/home/x/.local/share/Mnemo/images/b.png')).toContain('/api/notes/assets/legacy?path=');
  });

  it('refuses shapes that are not stored references', () => {
    expect(noteAssetRequestPath('')).toBeNull();
    expect(noteAssetRequestPath('https://example.com/x.png')).toBeNull();
    expect(noteAssetRequestPath('data:image/png;base64,AAAA')).toBeNull();
    expect(noteAssetRequestPath('a/b.png')).toBeNull();
  });
});
