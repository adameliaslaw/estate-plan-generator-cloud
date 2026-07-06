import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"

export interface ComboboxOption {
  value: string
  label: string
}

export interface ComboboxProps {
  options: ComboboxOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Message shown when the typed query matches no option. */
  emptyText?: string
  id?: string
  /** Applied to the text input (e.g. to size it: "h-9 w-56"). */
  className?: string
  disabled?: boolean
  "aria-invalid"?: boolean
}

/**
 * Combobox — a single-select dropdown that filters options as the user types.
 *
 * Behaves like the shadcn `Select` (same styling, click to open, pick one),
 * but the trigger is a text input: start typing and the list narrows to
 * matching options in real time. Selection is limited to the provided
 * options — the field always resolves to a real `value`, never freeform text.
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select…",
  emptyText = "No matches found.",
  id,
  className,
  disabled,
  "aria-invalid": ariaInvalid,
}: ComboboxProps) {
  const selectedLabel = React.useMemo(
    () => options.find((o) => o.value === value)?.label ?? "",
    [options, value],
  )

  const [open, setOpen] = React.useState(false)
  // `dirty` = the user has typed since opening; controls whether we show the
  // selected label or the live query, and whether we filter.
  const [dirty, setDirty] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [highlight, setHighlight] = React.useState(-1)

  const containerRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLUListElement>(null)

  const displayValue = dirty ? query : selectedLabel

  const q = dirty ? query.trim().toLowerCase() : ""
  const filtered = React.useMemo(
    () => (q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options),
    [options, q],
  )

  // Close (and reset the query) on any click outside the component.
  React.useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setDirty(false)
        setQuery("")
        setHighlight(-1)
      }
    }
    document.addEventListener("mousedown", onDocMouseDown)
    return () => document.removeEventListener("mousedown", onDocMouseDown)
  }, [])

  // Keep the highlighted option scrolled into view.
  React.useEffect(() => {
    if (open && highlight >= 0 && listRef.current) {
      const el = listRef.current.children[highlight] as HTMLElement | undefined
      el?.scrollIntoView({ block: "nearest" })
    }
  }, [highlight, open])

  function select(opt: ComboboxOption) {
    onChange(opt.value)
    setOpen(false)
    setDirty(false)
    setQuery("")
    setHighlight(-1)
    inputRef.current?.blur()
  }

  function openMenu() {
    if (disabled) return
    setOpen(true)
    setDirty(false)
    setQuery("")
    setHighlight(-1)
    // Select existing text so the first keystroke replaces it.
    inputRef.current?.select()
  }

  function closeMenu() {
    setOpen(false)
    setDirty(false)
    setQuery("")
    setHighlight(-1)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        if (!open) {
          openMenu()
          return
        }
        setHighlight((p) => Math.min(p + 1, filtered.length - 1))
        break
      case "ArrowUp":
        e.preventDefault()
        setHighlight((p) => Math.max(p - 1, 0))
        break
      case "Enter":
        if (open) {
          e.preventDefault()
          if (highlight >= 0 && highlight < filtered.length) select(filtered[highlight])
          else if (filtered.length === 1) select(filtered[0])
        }
        break
      case "Escape":
        e.preventDefault()
        closeMenu()
        inputRef.current?.blur()
        break
      case "Tab":
        closeMenu()
        break
    }
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-invalid={ariaInvalid}
          autoComplete="off"
          disabled={disabled}
          value={displayValue}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value)
            setDirty(true)
            setOpen(true)
            setHighlight(-1)
          }}
          onFocus={openMenu}
          onKeyDown={handleKeyDown}
          className={cn(
            "flex h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 pr-9 text-sm text-gray-900 ring-offset-white placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b6cb0] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        />
        <ChevronsUpDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          aria-hidden
        />
      </div>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-500">{emptyText}</li>
          ) : (
            filtered.map((opt, idx) => (
              <li
                key={opt.value}
                role="option"
                aria-selected={opt.value === value}
                onMouseDown={(e) => {
                  // Prevent the input blur that would otherwise fire first.
                  e.preventDefault()
                  select(opt)
                }}
                onMouseEnter={() => setHighlight(idx)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm transition-colors",
                  idx === highlight ? "bg-[#ebf4ff] text-[#1a365d]" : "text-gray-700",
                  opt.value === value && idx !== highlight && "font-medium text-[#1a365d]",
                )}
              >
                <span className="truncate">{opt.label}</span>
                {opt.value === value && <Check className="h-4 w-4 shrink-0 text-[#2b6cb0]" />}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
