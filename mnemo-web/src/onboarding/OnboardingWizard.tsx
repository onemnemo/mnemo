import { Dialog } from "radix-ui"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"
import { useNeedsOnboarding, useSettingsStore, useSettingValue } from "@/settings/store"
import { toast } from "@/stores/toast"

import { LanguageStep } from "./steps/LanguageStep"
import { PersonalizeStep } from "./steps/PersonalizeStep"
import { WelcomeStep } from "./steps/WelcomeStep"

const STEPS = ["welcome", "language", "personalize"] as const
type Step = (typeof STEPS)[number]

const TITLES: Record<Step, { title: string; description: string }> = {
  welcome: { title: "WelcomeTitle", description: "WelcomeDescription" },
  language: { title: "LanguageTitle", description: "LanguageDescription" },
  personalize: { title: "PersonalizeTitle", description: "PersonalizeDescription" },
}

/**
 * First-run setup: welcome, language, then personalization.
 *
 * Not dismissible — no escape, no outside click, no close button — because the app
 * behind it has no name, theme or language chosen yet. It reuses the settings
 * pickers, which write through as they are clicked; only the display name is held
 * until the step is left.
 */
export function OnboardingWizard() {
  const t = useT()
  const needsOnboarding = useNeedsOnboarding()
  const setValue = useSettingsStore((s) => s.setValue)
  const savedName = useSettingValue("User.DisplayName", "")

  const [index, setIndex] = useState(0)
  const [name, setName] = useState(savedName)
  const [finishing, setFinishing] = useState(false)

  if (!needsOnboarding) return null

  const step = STEPS[index]!
  const isLast = index === STEPS.length - 1

  /**
   * Commits the typed name when leaving the personalization step, in either
   * direction. A blank field is ignored rather than clearing an existing name.
   */
  async function commitName() {
    if (step !== "personalize") return
    const trimmed = name.trim()
    if (trimmed && trimmed !== savedName) await setValue("User.DisplayName", trimmed)
  }

  async function back() {
    await commitName()
    setIndex((i) => Math.max(0, i - 1))
  }

  async function next() {
    await commitName()
    if (!isLast) {
      setIndex((i) => i + 1)
      return
    }

    setFinishing(true)
    await setValue("Onboarding.Completed", true)
    window.location.hash = "#/overview"
    toast.info(t("Onboarding", "PostOnboardingWelcomeTitle"), {
      description: t("Onboarding", "PostOnboardingWelcomeMessage"),
      durationMs: 8000,
    })
  }

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100%-3rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-[var(--overlay-background)] shadow-elevation-4 focus:outline-none"
        >
          <header className="px-6 pb-4 pt-6">
            <p className="text-micro font-semibold uppercase tracking-[1px] text-text-faded">
              {/* Untranslated in the desktop wizard too. */}
              {index + 1} of {STEPS.length}
            </p>
            <Dialog.Title className="mt-1 text-heading-5 font-semibold text-text-primary">
              {t("Onboarding", TITLES[step].title)}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-body-small leading-relaxed text-text-tertiary">
              {t("Onboarding", TITLES[step].description)}
            </Dialog.Description>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-2">
            {step === "welcome" ? <WelcomeStep /> : null}
            {step === "language" ? <LanguageStep /> : null}
            {step === "personalize" ? <PersonalizeStep name={name} onNameChange={setName} /> : null}
          </div>

          <footer className="flex items-center justify-between gap-3 border-t p-4">
            <span className="text-micro text-text-faded">
              {index > 0 ? (
                <Button variant="ghost" size="sm" disabled={finishing} onClick={() => void back()}>
                  {t("Common", "Back")}
                </Button>
              ) : null}
            </span>
            <Button size="sm" disabled={finishing} onClick={() => void next()}>
              {t("Common", isLast ? "Finish" : "Next")}
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
