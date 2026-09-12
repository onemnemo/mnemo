// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { DOMSerializer, Fragment } from 'prosemirror-model';
import { createEditorSchema } from './index';

describe('mark rendering', () => {
  const { schema } = createEditorSchema();

  it.each(['sub', 'sup'] as const)(
    'renders underline and strike inside %s so their lines follow the script baseline',
    (script) => {
      const scriptSet = schema.marks[script].create().addToSet([]);
      const strikeSet = schema.marks.strike.create().addToSet(scriptSet);
      const marks = schema.marks.underline.create().addToSet(strikeSet);
      const rendered = DOMSerializer.fromSchema(schema).serializeFragment(
        Fragment.from(schema.text('2', marks)),
        { document },
      );
      const host = document.createElement('div');
      host.append(rendered);

      expect(host.querySelector(`${script} > u > s`)?.textContent).toBe('2');
    },
  );
});
