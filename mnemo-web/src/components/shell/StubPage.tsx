// Placeholder for routes whose real UI is not built yet. Keeps the shell
// navigable and lets the design tokens be exercised across every route.
export function StubPage({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <h1 className="text-heading-3 font-semibold text-foreground">{title}</h1>
      <p className="text-body-small text-muted-foreground">
        {subtitle ?? "Coming soon."}
      </p>
    </div>
  )
}
