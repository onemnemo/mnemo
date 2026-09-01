// @vitest-environment jsdom

/**
 * The one measurement a size preset and a resize ceiling are both fractions of.
 *
 * jsdom lays nothing out, so every rect here is written rather than measured. The assertion is
 * about which element is asked: the figure hugs its picture, so measuring the figure would make
 * every answer a fraction of the picture the block already is.
 */

import { describe, expect, it } from 'vitest';
import type { EditorView } from 'prosemirror-view';

import { imageColumnWidth, imageColumnWidthAt } from './image-column';

/** A hugging figure of `figureWidth` inside a column of `columnWidth`, laid out by hand. */
function mount(columnWidth: number, figureWidth = 240): { column: HTMLElement; figure: HTMLElement } {
  const column = document.createElement('div');
  column.getBoundingClientRect = () => new DOMRect(0, 0, columnWidth, 400);
  const figure = document.createElement('figure');
  figure.getBoundingClientRect = () => new DOMRect(0, 0, figureWidth, 100);
  column.appendChild(figure);
  document.body.appendChild(column);
  return { column, figure };
}

function viewOver(dom: unknown): EditorView {
  return { nodeDOM: () => dom } as unknown as EditorView;
}

describe('imageColumnWidth', () => {
  it('measures the column the figure sits in rather than the figure', () => {
    const { figure } = mount(600, 240);
    expect(figure.getBoundingClientRect().width).toBe(240);
    expect(imageColumnWidth(figure)).toBe(600);
  });

  it('takes off the column padding and border, which no block can be laid out in', () => {
    const { column, figure } = mount(600);
    column.style.padding = '0 16px';
    column.style.borderLeft = '2px solid';
    column.style.borderRight = '2px solid';
    expect(imageColumnWidth(figure)).toBe(600 - 32 - 4);
  });

  it('answers nothing for a figure with no column and for a column with no layout', () => {
    expect(imageColumnWidth(null)).toBe(0);
    expect(imageColumnWidth(document.createElement('figure'))).toBe(0);
    expect(imageColumnWidth(mount(0).figure)).toBe(0);
  });

  it('reads the block at a position through the view, and answers nothing without one', () => {
    const { figure } = mount(720);
    expect(imageColumnWidthAt(viewOver(figure), 4)).toBe(720);
    expect(imageColumnWidthAt(viewOver(null), 4)).toBe(0);
    expect(imageColumnWidthAt(viewOver(document.createTextNode('x')), 4)).toBe(0);
  });
});
