import { MutationCache, QueryClient } from "@tanstack/react-query"

import { useI18nStore } from "@/i18n/store"
import { createTranslate } from "@/i18n/translate"
import { toast } from "@/stores/toast"

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /** Opts a mutation out of the global failure toast, for one that already reports its own. */
      silentError?: boolean
    }
  }
}

// Desktop webview: no other tab/window competes for network focus, and a
// refetch storm on every Alt-Tab back into the app is just wasted requests.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
  // Without this, a failed write is silent: the query rolls back or stays stale and nothing on
  // screen says why. `silentError` exists because a handful of call sites already show a more
  // specific toast (a deck move, a card save); this would otherwise double up on those.
  mutationCache: new MutationCache({
    onError: (error, _variables, _onMutateResult, mutation) => {
      if (mutation.meta?.silentError) return
      console.error("[app] a mutation failed", error)
      const t = createTranslate(useI18nStore.getState().bundle)
      toast.warning(t("App", "MutationErrorTitle"))
    },
  }),
})
