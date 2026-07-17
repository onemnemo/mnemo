import { useDecksQuery } from "@/api/decks"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

const SKELETON_COUNT = 3

export function DecksPage() {
  const { data, isLoading, isError, error, refetch } = useDecksQuery()

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="mb-6 text-2xl font-semibold text-foreground">Decks</h1>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: SKELETON_COUNT }).map((_, index) => (
            <Card key={index}>
              <CardHeader>
                <Skeleton className="h-5 w-2/3" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-1/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">
            {error?.message ?? "Something went wrong loading decks."}
          </p>
          <Button variant="outline" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No decks yet</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((deck) => (
            <Card key={deck.id}>
              <CardHeader>
                <CardTitle>{deck.name}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {deck.totalCards} {deck.totalCards === 1 ? "card" : "cards"}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
