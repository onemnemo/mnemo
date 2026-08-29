import { useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { WindowControls } from "@/components/shell/chrome/WindowControls"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"
import { onTitlebarPointerDown } from "@/lib/window"
import { Z_LAYERS } from "@/lib/z-layers"
import { useSettingValue, useSettingsStore } from "@/settings/store"
import { useDialogStore } from "@/stores/dialog"

import { completeOnboarding, useNeedsFirstRun } from "./first-run"
import {
  canJumpTo,
  isQuestion,
  nextStep,
  previousStep,
  questionIndex,
  QUESTIONS,
  type OnboardingStep,
} from "./steps"
import { AppearanceStep } from "./steps/AppearanceStep"
import { DoneStep } from "./steps/DoneStep"
import { IdentityStep } from "./steps/IdentityStep"
import { LanguageStep } from "./steps/LanguageStep"
import { WelcomeStep } from "./steps/WelcomeStep"

/** The same measure a settings page uses. A form is a form. */
const MEASURE = 560

/**
 * First-time setup.
 *
 * Not a dialog. A dialog implies something behind it worth going back to, and on a genuine
 * first launch there is nothing there. So this is the window for as long as it runs, which
 * means it has to carry its own titlebar: a takeover that swallows the drag region is one
 * you cannot move, minimize or close.
 *
 * There is no Save button anywhere in it. Every answer writes as it is given, exactly as it
 * would on the settings page it was borrowed from, which is what lets skipping be a real
 * exit instead of an abandoned job.
 */
export function OnboardingWizard() {
  const t = useT()
  const needsFirstRun = useNeedsFirstRun()
  const setValue = useSettingsStore((s) => s.setValue)
  const savedName = useSettingValue("User.DisplayName", "")
  // Dim and disable onboarding while a queued dialog is active.
  const dialogPending = useDialogStore((s) => s.queue.length > 0)

  const [step, setStep] = useState<OnboardingStep>("welcome")
  // Null until the field is touched, so the box picks up the stored name whenever the
  // snapshot lands rather than keeping whatever was loaded at mount, which is nothing.
  const [typed, setTyped] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)

  if (!needsFirstRun) return null

  const name = typed ?? savedName

  /** The one thing every way out of the name step has in common, forwards, back or skip. */
  async function commitName() {
    if (typed === null) return
    const trimmed = typed.trim()
    if (trimmed.length > 0 && trimmed !== savedName) await setValue("User.DisplayName", trimmed)
  }

  async function go(next: OnboardingStep | null) {
    if (next === null) return
    await commitName()
    setStep(next)
  }

  /**
   * The way out, taken by finishing and by skipping alike. Nothing navigates: the shell is
   * already mounted on its landing route behind this, so recording completion is the whole
   * of it, and steering the hash from here would override where the app was told to open.
   */
  async function exit() {
    setLeaving(true)
    await commitName()
    await completeOnboarding()
    // The write is optimistic and rolls itself back on failure, and a rolled-back
    // completion leaves this screen up. It has to keep its way out when that happens.
    setLeaving(false)
  }

  const at = questionIndex(step)

  return (
    <div
      aria-hidden={dialogPending}
      className="animate-fade-in fixed inset-0 flex flex-col bg-canvas transition-opacity"
      style={{
        zIndex: Z_LAYERS.onboarding,
        transitionDuration: "var(--duration-normal)",
        opacity: dialogPending ? 0 : 1,
        pointerEvents: dialogPending ? "none" : undefined,
      }}
    >
      <header
        onPointerDown={onTitlebarPointerDown}
        className="drag-region flex shrink-0 items-center justify-between pl-3.5"
        style={{ height: "var(--topbar-h)" }}
      >
        {/* The icon, not the wordmark: the wordmark is on the welcome screen two inches
            below, and saying it twice makes the second one look like a header that forgot
            it had already introduced itself. */}
        <AppIcon
          name="branding/logo-icon"
          width={20}
          height={17}
          className="pointer-events-none text-accent"
        />

        <div className="flex h-full items-center">
          {/* Welcome offers skipping as one of its two answers and the closing screen has
              nothing left to skip, so the header carries it only where it is the way out. */}
          {isQuestion(step) && (
            <Button variant="ghost" size="sm" disabled={leaving} onClick={() => void exit()}>
              {t("Onboarding", "Skip")}
            </Button>
          )}
          <WindowControls />
        </div>
      </header>

      <main className="scroll-thin flex min-h-0 flex-1 overflow-y-auto px-8 py-6">
        {/* Keyed on the step so each screen animates in rather than swapping in place. */}
        <div key={step} className="animate-rise m-auto w-full" style={{ maxWidth: MEASURE }}>
          {step === "welcome" && <WelcomeStep onSetUp={() => void go("you")} onSkip={() => void exit()} />}
          {step === "you" && <IdentityStep name={name} onNameChange={setTyped} onSubmit={() => void go("look")} />}
          {step === "look" && <AppearanceStep />}
          {step === "lang" && <LanguageStep />}
          {step === "done" && <DoneStep onStart={() => void exit()} />}
        </div>
      </main>

      {at !== -1 && (
        <footer className="shrink-0 px-8 pb-7">
          <div className="mx-auto flex w-full items-center" style={{ maxWidth: MEASURE }}>
            <Button
              variant="ghost"
              icon={<AppIcon name="chevron-left" size={14} strokeWidth={1.8} />}
              onClick={() => void go(previousStep(step))}
            >
              {t("Common", "Back")}
            </Button>

            <div className="flex flex-1 items-center justify-center gap-1.5">
              {QUESTIONS.map((question, index) => (
                <button
                  key={question}
                  type="button"
                  aria-label={t("Onboarding", "StepFormat", { 0: index + 1 })}
                  onClick={() => {
                    if (canJumpTo(question, step)) void go(question)
                  }}
                  disabled={index > at}
                  className={cn(
                    "size-1.5 rounded-full transition-colors",
                    index <= at ? "bg-solid" : "bg-line",
                    index < at && "hover:bg-ink-2",
                  )}
                  style={{ transitionDuration: "var(--duration-fast)" }}
                />
              ))}
            </div>

            <Button
              variant="solid"
              className="px-3"
              trailing={<AppIcon name="chevron-right" size={14} strokeWidth={1.8} />}
              onClick={() => void go(nextStep(step))}
            >
              {t("Common", "Continue")}
            </Button>
          </div>
        </footer>
      )}
    </div>
  )
}
