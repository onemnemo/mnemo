import { useEffect, useMemo, useRef, useState } from 'react'

import { AppIcon } from '@/components/icon/AppIcon'
import { Menu, MenuCheckItem, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n/useT'

import { codeLanguages, codeLanguageLabel } from './languages'

/**
 * The code block's chrome: what language this is, a copy button, and everything
 * else behind the ellipsis.
 *
 * The rule is the note pane's own, a reading surface first. Nothing is on the
 * block until the pointer is, and what appears is the three things anyone
 * actually reaches for. Hover and focus both reveal it, so the keyboard route
 * into the toolbar is not a route into an invisible one.
 *
 * Mounted into the block through the NodeView portal bridge, which is why this
 * is a component and not more imperative DOM beside the rest of the view: the
 * language list and the options menu are anchored, collision-aware surfaces, and
 * hand-rolling that flip is how a menu ends up half off the screen.
 */

const BUTTON =
  'grid size-7 place-items-center rounded-md text-text-faded transition-colors hover:bg-surface-subtle hover:text-foreground aria-expanded:bg-surface-subtle aria-expanded:text-foreground'

/** How long the tick stands in for the copy glyph. */
const COPIED_MS = 1600

export interface CodeChromeProps {
  language: string
  wrap: boolean
  numbers: boolean
  /** Whether the caption row is currently showing, not whether it has text. */
  caption: boolean
  onLanguage: (value: string) => void
  onWrap: () => void
  onNumbers: () => void
  onCaption: () => void
  /** Resolves false when the clipboard refused, which is the only failure worth drawing. */
  onCopy: () => Promise<boolean>
}

export function CodeChrome(props: CodeChromeProps) {
  const t = useT()
  const nt = (key: string) => t('NotesEditor', key)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  return (
    <div className="notes-code-chrome" contentEditable={false} suppressContentEditableWarning>
      <LanguagePicker value={props.language} onChange={props.onLanguage} />
      <button
        type="button"
        tabIndex={-1}
        aria-label={nt('CodeCopy')}
        title={nt('CodeCopy')}
        className={BUTTON}
        // Keeps the caret where it was: a press on chrome is not a place to type.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => void props.onCopy().then((ok) => ok && setCopied(true))}
      >
        {/* Same ink as the icon it replaces. Green would be the app congratulating
            you for pressing a button, and the tick already says the only thing
            there is to say. */}
        <AppIcon name={copied ? 'check' : 'copy'} size={14} />
      </button>
      <Menu>
        <MenuTrigger asChild>
          <button type="button" tabIndex={-1} aria-label={nt('CodeOptions')} className={BUTTON}>
            <AppIcon name="ellipsis" size={15} />
          </button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuCheckItem checked={props.caption} icon="captions" onSelect={props.onCaption}>
            {nt('CodeCaption')}
          </MenuCheckItem>
          <MenuCheckItem checked={props.wrap} icon="wrap-text" onSelect={props.onWrap}>
            {nt('CodeWrap')}
          </MenuCheckItem>
          <MenuCheckItem checked={props.numbers} icon="hash" onSelect={props.onNumbers}>
            {nt('CodeLineNumbers')}
          </MenuCheckItem>
          <MenuSeparator />
          <MenuItem icon="copy" onSelect={() => void props.onCopy()}>
            {nt('CodeCopy')}
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  )
}

/**
 * The language list.
 *
 * Forty languages is past the point where scanning works, which is the only
 * reason this list gets a filter and the block menus do not. It is a purpose
 * built picker rather than a shared Select because the app has no other list
 * this long, and inventing a general control to serve one caller is how a design
 * system acquires a component nobody agreed to.
 */
function LanguagePicker({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle.length === 0) return codeLanguages
    // Prefix before substring, so typing "r" offers R and Ruby before Perl.
    const prefix = codeLanguages.filter((l) => l.label.toLowerCase().startsWith(needle))
    const rest = codeLanguages.filter(
      (l) => !l.label.toLowerCase().startsWith(needle) && l.label.toLowerCase().includes(needle),
    )
    return [...prefix, ...rest]
  }, [query])

  useEffect(() => {
    if (open) return
    setQuery('')
    setActive(0)
  }, [open])

  // Follow the highlight rather than leaving it below the fold; the list is
  // taller than its box for every query short enough to match a lot.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, query])

  const choose = (next: string) => {
    onChange(next)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          aria-label={t('NotesEditor', 'CodeLanguage')}
          onMouseDown={(event) => event.preventDefault()}
          className="flex h-7 items-center gap-1 rounded-md px-2 text-body-extra-small text-text-secondary transition-colors hover:bg-surface-subtle hover:text-foreground aria-expanded:bg-surface-subtle"
        >
          <span className="max-w-[10rem] truncate">{codeLanguageLabel(value)}</span>
          <AppIcon name="chevron-down" size={12} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-0">
        <div className="border-b border-line p-1">
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                const step = event.key === 'ArrowDown' ? 1 : -1
                setActive((at) => (matches.length === 0 ? 0 : (at + step + matches.length) % matches.length))
                return
              }
              if (event.key === 'Enter' && matches[active]) {
                event.preventDefault()
                choose(matches[active].value)
              }
            }}
            placeholder={t('NotesEditor', 'CodeLanguageSearch')}
            aria-label={t('NotesEditor', 'CodeLanguageSearch')}
            className="w-full rounded-md bg-transparent px-2 py-1 text-body-extra-small text-foreground outline-none placeholder:text-text-faded"
          />
        </div>
        <div ref={listRef} role="listbox" className="scroll-thin max-h-64 overflow-y-auto p-1">
          {matches.map((language, index) => (
            <button
              key={language.value}
              type="button"
              role="option"
              aria-selected={language.value === value}
              data-active={index === active ? 'true' : undefined}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(language.value)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-body-extra-small text-text-secondary',
                index === active && 'bg-surface-subtle text-foreground',
              )}
            >
              <span className="grid size-[14px] shrink-0 place-items-center">
                {language.value === value ? <AppIcon name="common/check" size={13} /> : null}
              </span>
              <span className="flex-1 truncate">{language.label}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
