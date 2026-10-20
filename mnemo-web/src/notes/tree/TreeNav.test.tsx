// @vitest-environment jsdom

import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TreeNav } from './TreeNav';
import { useTabStop } from './useTabStop';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const keys = ['a', 'b', 'c', 'd', 'e'];
const renders = new Map<string, number>();

function Row({ treeKey }: { treeKey: string }) {
  const tabIndex = useTabStop(treeKey);
  renders.set(treeKey, (renders.get(treeKey) ?? 0) + 1);
  return <div role="treeitem" tabIndex={tabIndex} data-tree-key={treeKey} data-row-depth={0} />;
}

// One element for the whole tree, as the sidebar passes it. Only a row's own subscription can re-render it.
const rows = (
  <>
    {keys.map((key) => (
      <Row key={key} treeKey={key} />
    ))}
  </>
);

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  renders.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const item = (key: string) => container.querySelector<HTMLElement>(`[data-tree-key="${key}"]`)!;

describe('TreeNav tab stop', () => {
  it('re-renders only the row that loses the tab stop and the row that gains it', () => {
    act(() =>
      root.render(
        <StrictMode>
          <TreeNav label="t" keys={keys} fallbackKey="a" onToggle={() => {}}>
            {rows}
          </TreeNav>
        </StrictMode>,
      ),
    );
    expect(keys.map((key) => item(key).tabIndex)).toEqual([0, -1, -1, -1, -1]);

    const before = new Map(renders);
    act(() => item('c').focus());
    expect(keys.map((key) => item(key).tabIndex)).toEqual([-1, -1, 0, -1, -1]);

    const rerendered = keys.filter((key) => renders.get(key) !== before.get(key));
    expect(rerendered).toEqual(['a', 'c']);
  });
});
