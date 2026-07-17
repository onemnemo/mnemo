// Profile avatar. A placeholder mark until the profile-picture setting is wired;
// opens profile settings in the real app.
export function ProfileButton() {
  return (
    <button type="button" aria-label="Profile" title="Profile" className="grid size-[22px] place-items-center p-0.5">
      <span className="grid size-[18px] place-items-center overflow-hidden rounded-full bg-[var(--card-icon-background)] text-[10px] font-semibold text-text-tertiary">
        M
      </span>
    </button>
  )
}
