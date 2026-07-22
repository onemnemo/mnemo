import type { TranslateFn } from "@/i18n/types"

import type { ChatProcessStep, ChatToolEvent } from "./types"

// Live process-trace reducer. Folds the turn stream's status/tool/reasoning/
// narration signals into the same ChatProcessStep[] shape the server persists,
// so one panel renders both the live trace and a reloaded one.
//
// This mirrors the grouping in Mnemo.Host/Chat/ChatTraceBuilder.cs and the label
// resolution in Mnemo.UI/Services/ChatToolVocabulary.cs. It only drives the
// transient streaming view: on a successful turn the store swaps in the server's
// canonical persisted message (resolved header/elapsed/summary and all), so the
// authoritative trace shape always comes from one place, the server. Keeping a
// light client mirror here just avoids a blank panel while tokens arrive.

const NS = "Chat"

// Pipeline status keys (Mnemo.Core/Models/ChatPipelineStatusKeys). Only routing
// and model-prep become steps; "writing/continuing the answer" is answer
// bookkeeping and is never surfaced, and running-tool echoes ("RT:name") are
// ignored here because the richer tool lifecycle arrives via addToolCall.
const KEY_ROUTING = "PipelineStatusRouting"
const KEY_LOADING_SKILLS = "PipelineStatusLoadingSkills"
const KEY_CLASSIFYING = "PipelineStatusClassifying"
const KEY_PREPARING_MODEL = "PipelineStatusPreparingModel"
const RUNNING_TOOL_PREFIX = "RT:"

const ROUTING_KEYS = new Set([KEY_ROUTING, KEY_LOADING_SKILLS, KEY_CLASSIFYING])

interface LiveStep {
  runningLabel: string
  doneLabel: string | null
  detail: string | null
  narration: string | null
  phaseKind: string
  isComplete: boolean
  isActive: boolean
  tool: { name: string; arguments: string; result: string; summary: string } | null
}

function stepLabel(step: LiveStep): string {
  return step.isComplete && step.doneLabel ? step.doneLabel : step.runningLabel
}

/**
 * Accumulates trace steps for one in-flight turn. Held (mutable) in the store's
 * turn state; call {@link snapshot} after each event to get an immutable array
 * for React. Mirrors the desktop tracker, which is likewise a stateful object.
 */
export class LiveTraceBuilder {
  private readonly steps: LiveStep[] = []
  private readonly stepsByToolId = new Map<string, LiveStep>()
  private reasoningText: string | null = null

  get reasoning(): string | null {
    return this.reasoningText
  }

  /** Routing / model-prep advancement. Tool lifecycle and answer bookkeeping are deliberately ignored. */
  onPipelineKey(key: string, t: TranslateFn): void {
    if (!key) return
    if (key.startsWith(RUNNING_TOOL_PREFIX)) return

    if (ROUTING_KEYS.has(key)) {
      this.bumpRouting(t)
      return
    }

    if (key === KEY_PREPARING_MODEL) {
      if (this.lastIsActive("Model")) return
      this.advanceSimple(t(NS, KEY_PREPARING_MODEL), "Model")
    }
    // "Writing/continuing the answer" keys are answer bookkeeping, never steps.
  }

  /** Records a tool-call lifecycle event: a running event opens an active row; the terminal event resolves it. */
  addToolCall(evt: ChatToolEvent, t: TranslateFn): void {
    const vocab = resolveTool(evt.name, evt.arguments, evt.result, t)

    if (evt.stage !== "running" && evt.id) {
      const existing = this.stepsByToolId.get(evt.id)
      if (existing) {
        this.resolveToolStep(existing, evt, vocab, t)
        return
      }
    }

    this.completeActive()

    const step: LiveStep = {
      runningLabel: vocab.runningLabel,
      doneLabel: vocab.doneLabel,
      detail: vocab.chip,
      narration: null,
      phaseKind: "Tool",
      isComplete: false,
      isActive: false,
      tool: { name: evt.name, arguments: evt.arguments ?? "", result: "", summary: "" },
    }

    if (evt.stage === "running") {
      step.isActive = true
      if (evt.id) this.stepsByToolId.set(evt.id, step)
    } else {
      this.resolveToolStep(step, evt, vocab, t)
    }

    this.steps.push(step)
  }

  /** Adds a quiet quoted row for mid-turn narration. Blank narration is counted but shows no row. */
  addNarration(text: string): void {
    if (!text || !text.trim()) return
    this.completeActive()
    this.steps.push({
      runningLabel: "",
      doneLabel: null,
      detail: null,
      narration: text.trim(),
      phaseKind: "Narration",
      isComplete: true,
      isActive: false,
      tool: null,
    })
  }

  /** Latest full reasoning text (the orchestrator replaces, not appends). */
  setReasoning(text: string): void {
    this.reasoningText = text ? text : null
  }

  /** Marks every step complete. Call once the turn ends. */
  complete(): void {
    for (const s of this.steps) {
      s.isActive = false
      s.isComplete = true
    }
  }

  /** Immutable snapshot as persisted-shaped process steps (empty when nothing was recorded). */
  snapshot(): ChatProcessStep[] {
    return this.steps.map((s) => ({
      label: stepLabel(s),
      detail: s.detail,
      narration: s.narration,
      phaseKind: s.phaseKind,
      isComplete: s.isComplete,
      toolCalls: s.tool
        ? [{ name: s.tool.name, arguments: s.tool.arguments, result: s.tool.result, summary: s.tool.summary }]
        : null,
    }))
  }

  private resolveToolStep(step: LiveStep, evt: ChatToolEvent, vocab: ToolVocab, t: TranslateFn): void {
    if (step.tool) {
      step.tool.result = evt.result ?? ""
      step.tool.summary = evt.stage === "failed" ? t(NS, "ToolCallFailed") : (vocab.suffix ?? "")
    }
    if (vocab.chip) step.detail = vocab.chip
    step.isActive = false
    step.isComplete = true
  }

  private bumpRouting(t: TranslateFn): void {
    const last = this.steps[this.steps.length - 1]
    if (last && last.phaseKind === "Routing" && last.isActive) return

    this.completeActive()
    this.steps.push({
      runningLabel: t(NS, KEY_ROUTING),
      doneLabel: t(NS, "RoutingDone"),
      detail: null,
      narration: null,
      phaseKind: "Routing",
      isComplete: false,
      isActive: true,
      tool: null,
    })
  }

  private advanceSimple(label: string, phaseKind: string): void {
    this.completeActive()
    this.steps.push({
      runningLabel: label,
      doneLabel: label,
      detail: null,
      narration: null,
      phaseKind,
      isComplete: false,
      isActive: true,
      tool: null,
    })
  }

  private lastIsActive(phaseKind: string): boolean {
    const last = this.steps[this.steps.length - 1]
    return !!last && last.phaseKind === phaseKind && last.isActive
  }

  private completeActive(): void {
    for (const s of this.steps) {
      if (!s.isActive) continue
      s.isActive = false
      s.isComplete = true
    }
  }
}

// --- Tool vocabulary (compact port of ChatToolVocabulary) --------------------

interface ToolVocab {
  runningLabel: string
  doneLabel: string
  chip: string | null
  suffix: string | null
}

// tool id -> (running key, done key) in the Chat namespace.
const LABEL_KEYS: Record<string, [string, string]> = {
  search_notes: ["ToolRunSearchNotes", "ToolDoneSearchNotes"],
  outline_note: ["ToolRunReadNote", "ToolDoneReadNote"],
  read_note: ["ToolRunReadNote", "ToolDoneReadNote"],
  edit_note: ["ToolRunEditNote", "ToolDoneEditNote"],
  create_note: ["ToolRunCreateNote", "ToolDoneCreateNote"],
  manage_note: ["ToolRunManageNote", "ToolDoneManageNote"],
  open_note: ["ToolRunOpenNote", "ToolDoneOpenNote"],
  list_settings: ["ToolRunListSettings", "ToolDoneListSettings"],
  get_setting: ["ToolRunGetSetting", "ToolDoneGetSetting"],
  set_setting: ["ToolRunSetSetting", "ToolDoneSetSetting"],
  reset_setting: ["ToolRunResetSetting", "ToolDoneResetSetting"],
  search_mindmaps: ["ToolRunSearchMindmaps", "ToolDoneSearchMindmaps"],
  find_in_map: ["ToolRunSearchMindmaps", "ToolDoneSearchMindmaps"],
  create_mindmap: ["ToolRunCreateMindmap", "ToolDoneCreateMindmap"],
  outline_mindmap: ["ToolRunReadMindmap", "ToolDoneReadMindmap"],
  read_elements: ["ToolRunReadMindmap", "ToolDoneReadMindmap"],
  edit_mindmap: ["ToolRunEditMindmap", "ToolDoneEditMindmap"],
  navigate_to: ["ToolRunNavigate", "ToolDoneNavigate"],
  open_settings: ["ToolRunNavigate", "ToolDoneNavigate"],
  web_search: ["ToolRunWebSearch", "ToolDoneWebSearch"],
  search_web: ["ToolRunWebSearch", "ToolDoneWebSearch"],
  // Internal orchestration plumbing, surfaced quietly as "getting ready", never by name.
  get_skills: ["ToolRunPreparing", "ToolDonePreparing"],
  fetch_skill: ["ToolRunPreparing", "ToolDonePreparing"],
  inject_skill: ["ToolRunPreparing", "ToolDonePreparing"],
  get_analytics_skills: ["ToolRunPreparing", "ToolDonePreparing"],
  get_version: ["ToolRunPreparing", "ToolDonePreparing"],
  get_current_route: ["ToolRunPreparing", "ToolDonePreparing"],
}

const APPEARANCE_THEME_KEY = "Appearance.Theme"
const RESULT_ARRAY_NAMES = ["results", "items", "notes", "matches", "settings", "mindmaps", "sources", "hits", "blocks"]
const COUNTABLE_TOOLS = new Set(["search_notes", "search_mindmaps", "find_in_map", "list_settings", "web_search", "search_web"])

function resolveTool(
  toolName: string,
  argumentsJson: string | null,
  resultContent: string | null,
  t: TranslateFn,
): ToolVocab {
  const name = toolName ?? ""
  const chip = extractChip(name, argumentsJson)

  let runningKey: string
  let doneKey: string

  if (name === "set_setting" && isThemeWrite(argumentsJson)) {
    runningKey = "ToolRunSetTheme"
    doneKey = "ToolDoneSetTheme"
  } else if (name in LABEL_KEYS) {
    ;[runningKey, doneKey] = LABEL_KEYS[name]
  } else {
    // Unmapped: generic label, humanized name as the chip so nothing shows snake_case.
    return {
      runningLabel: t(NS, "ToolRunGeneric"),
      doneLabel: t(NS, "ToolDoneGeneric"),
      chip: chip ?? humanize(name),
      suffix: null,
    }
  }

  return {
    runningLabel: t(NS, runningKey),
    doneLabel: t(NS, doneKey),
    chip,
    suffix: extractSuffix(name, resultContent, t),
  }
}

/** Turns a snake_case tool id into human words, e.g. list_decks -> "List decks". */
function humanize(toolName: string): string {
  const words = (toolName ?? "").replace(/_/g, " ").trim()
  if (!words) return ""
  return words[0].toUpperCase() + words.slice(1)
}

function isThemeWrite(argumentsJson: string | null): boolean {
  const key = readStringArg(argumentsJson, "key")
  return key?.toLowerCase() === APPEARANCE_THEME_KEY.toLowerCase() || key?.toLowerCase() === "theme"
}

/** Best-effort value chip from the call arguments: a query, a theme/value, or a title. */
function extractChip(toolName: string, argumentsJson: string | null): string | null {
  if (!argumentsJson || !argumentsJson.trim()) return null
  switch (toolName) {
    case "set_setting":
    case "get_setting":
    case "reset_setting":
      return readStringArg(argumentsJson, "value") ?? readStringArg(argumentsJson, "key")
    case "search_notes":
    case "search_mindmaps":
    case "find_in_map":
    case "web_search":
    case "search_web":
      return readStringArg(argumentsJson, "query")
    case "create_note":
    case "create_mindmap":
      return readStringArg(argumentsJson, "title")
    default:
      return null
  }
}

/** Best-effort "· N found" style suffix from a search/list result. Omitted unless confident. */
function extractSuffix(toolName: string, resultContent: string | null, t: TranslateFn): string | null {
  if (!COUNTABLE_TOOLS.has(toolName) || !resultContent || !resultContent.trim()) return null
  const count = tryCountResults(resultContent)
  if (count === null) return null
  const formatKey = toolName === "web_search" || toolName === "search_web" ? "ToolSuffixSources" : "ToolSuffixFound"
  return t(NS, formatKey, { 0: count })
}

function readStringArg(argumentsJson: string | null, name: string): string | null {
  if (!argumentsJson || !argumentsJson.trim()) return null
  try {
    const root: unknown = JSON.parse(argumentsJson)
    if (typeof root !== "object" || root === null || Array.isArray(root)) return null
    const value = (root as Record<string, unknown>)[name]
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    return trimmed.length === 0 ? null : trimmed
  } catch {
    // Malformed args: no chip rather than a wrong one.
    return null
  }
}

/**
 * Counts result rows only when the shape is unambiguous, a top-level array, or an
 * object carrying a recognized array property (or a numeric `count`). Returns null
 * (no suffix) rather than risk a wrong number.
 */
function tryCountResults(resultContent: string): number | null {
  try {
    const root: unknown = JSON.parse(resultContent)
    if (Array.isArray(root)) return root.length
    if (typeof root === "object" && root !== null) {
      const obj = root as Record<string, unknown>
      for (const key of RESULT_ARRAY_NAMES) {
        if (Array.isArray(obj[key])) return (obj[key] as unknown[]).length
      }
      if (typeof obj.count === "number" && Number.isInteger(obj.count)) return obj.count
    }
  } catch {
    // Non-JSON or unexpected shape: no suffix.
  }
  return null
}
