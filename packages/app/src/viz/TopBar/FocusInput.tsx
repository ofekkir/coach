import { useState } from 'react';

import { fonts, tokens } from '../theme.ts';

export function FocusInput({ onFocus }: { onFocus: (id: string) => boolean }) {
  const [value, setValue] = useState('');
  const [notFound, setNotFound] = useState(false);

  const submit = () => {
    setNotFound(value.trim() !== '' && !onFocus(value));
  };

  return (
    <input
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        if (notFound) setNotFound(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') submit();
      }}
      placeholder="focus node id…"
      spellCheck={false}
      title={notFound ? 'no node with that id' : 'focus a node by id'}
      style={{
        width: 168,
        height: 26,
        padding: '0 9px',
        background: tokens.paper,
        border: `1px solid ${notFound ? tokens.accent : tokens.line}`,
        borderRadius: 7,
        outline: 'none',
        fontFamily: fonts.mono,
        fontSize: 11,
        color: notFound ? tokens.accentInk : tokens.ink,
      }}
    />
  );
}
