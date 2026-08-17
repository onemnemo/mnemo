/**
 * The table's strings, pinned against the real bundle.
 *
 * `translate` returns a miss as the bare key, so a typo here does not fail a
 * build, it ships a menu row labelled `TableClearContents`. The C# bundle tests
 * already guard that every other language carries every key English does, so
 * pinning English pins all five.
 */
import { describe, expect, it } from 'vitest';

import { mergedEnglishBundle, resolves } from '@/i18n/test-bundle';

import { tableTints } from './tints';

const TABLE_KEYS = [
  'Table',
  'TableDescription',
  'TableRowActions',
  'TableColumnActions',
  'TableAddRow',
  'TableAddColumn',
  'TableHeaderRow',
  'TableHeaderColumn',
  'TableFitToWidth',
  'TableColor',
  'TableInsertAbove',
  'TableInsertBelow',
  'TableInsertLeft',
  'TableInsertRight',
  'TableDuplicate',
  'TableClearContents',
  'TableDelete',
  'TableSectionTable',
  'TableSectionCell',
  'TableSectionCells',
  'TableInsertRowBelow',
  'TableInsertRowsBelow',
  'TableInsertColumnRight',
  'TableInsertColumnsRight',
  'TableDeleteRow',
  'TableDeleteRows',
  'TableDeleteColumn',
  'TableDeleteColumns',
] as const;

describe('table translations', () => {
  const bundle = mergedEnglishBundle();

  it.each(TABLE_KEYS)('resolves NotesEditor/%s', (key) => {
    expect(resolves(bundle, 'NotesEditor', key), `NotesEditor/${key} is missing`).toBe(true);
  });

  it('names every tint', () => {
    for (const tint of tableTints) {
      expect(resolves(bundle, 'NotesEditor', tint.labelKey), `${tint.labelKey} is missing`).toBe(true);
    }
  });

  it('keeps the counts in the plural rows', () => {
    expect(bundle.NotesEditor?.TableSectionCells ?? '').toContain('{0}');
    expect(bundle.NotesEditor?.TableSectionCells ?? '').toContain('{1}');
    expect(bundle.NotesEditor?.TableDeleteRows ?? '').toContain('{0}');
    expect(bundle.NotesEditor?.TableRowActions ?? '').toContain('{0}');
  });
});
