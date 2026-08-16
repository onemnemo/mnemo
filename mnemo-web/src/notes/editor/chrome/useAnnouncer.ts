import { useCallback, useState } from 'react';

/** The live region's text, plus the setter that makes a repeat speak again. */
export function useAnnouncer(): { message: string; announce: (message: string) => void } {
  const [message, setMessage] = useState('');

  const announce = useCallback((next: string) => {
    // Re-set even to the same text so a repeated action still speaks: a trailing
    // space forces a new string the screen reader treats as a fresh announcement.
    setMessage((prev) => (prev === next ? `${next} ` : next));
  }, []);

  return { message, announce };
}
