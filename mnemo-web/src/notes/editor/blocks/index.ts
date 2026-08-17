/**
 * The block module list.
 *
 * Adding a block type is one module file plus one line here. Order matters only
 * where ProseMirror has to fill a content expression it cannot otherwise
 * satisfy, which is why `paragraph` is first: it is the block every generic
 * `block+` position falls back to.
 */

import type { AnyBlockModule } from '../registry/types';
import type { BlockDeps } from './shared';
import { headingBlock, paragraphBlock, quoteBlock } from './prose';
import { bulletItemBlock, checklistItemBlock, numberedItemBlock } from './lists';
import { codeBlock, sketchBlock } from './source';
import { dividerBlock, equationBlockModule, pageBlock } from './atoms';
import { imageBlock } from './image';
import { columnGroupBlock, twoColumnBlock } from './columns';
import { calloutBlock } from './callout';
import { tableBlock, tableCellBlock, tableRowBlock } from './table';

/** Eighteen modules covering all twenty-one wire types; `heading` owns four. */
export function createBlockModules(deps: BlockDeps): readonly AnyBlockModule[] {
  return [
    paragraphBlock(deps),
    headingBlock(deps),
    bulletItemBlock(deps),
    numberedItemBlock(deps),
    checklistItemBlock(deps),
    quoteBlock(deps),
    calloutBlock(deps),
    codeBlock(deps),
    dividerBlock(deps),
    twoColumnBlock(deps),
    columnGroupBlock(deps),
    // After the columns so the slash menu reads in the desktop's insert order:
    // Divider, TwoColumn, Image, Equation.
    imageBlock(deps),
    // After the image, where the desktop's insert order would put it if it had
    // one: the media group, not the prose group.
    tableBlock(deps),
    tableRowBlock(deps),
    tableCellBlock(deps),
    equationBlockModule(deps),
    pageBlock(deps),
    sketchBlock(deps),
  ];
}
