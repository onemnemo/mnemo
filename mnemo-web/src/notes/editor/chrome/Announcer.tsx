/** Off-screen live region so a menu or keyboard action is spoken. */
export function Announcer({ message }: { message: string }) {
  return (
    <div aria-live="polite" role="status" className="sr-only">
      {message}
    </div>
  );
}
