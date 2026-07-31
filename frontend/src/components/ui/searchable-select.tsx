import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, Check, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SearchableSelectOption {
  value: string;
  label: string;
  group?: string;
}

interface SearchableSelectProps {
  value: string;
  onValueChange: (val: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
}

export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  disabled = false,
  className,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  const selectedLabel = options.find((o) => o.value === value)?.label;
  const displayValue = value && value !== "none" ? selectedLabel : undefined;

  const filtered = search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  // Group items
  const grouped: { group: string | undefined; items: SearchableSelectOption[] }[] = [];
  for (const item of filtered) {
    const last = grouped[grouped.length - 1];
    if (last && last.group === item.group) {
      last.items.push(item);
    } else {
      grouped.push({ group: item.group, items: [item] });
    }
  }

  function handleSelect(val: string) {
    onValueChange(val);
    setOpen(false);
    setSearch("");
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) setSearch("");
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors",
            "focus:outline-none focus:border-ring",
            "data-[state=open]:border-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            !displayValue && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">{displayValue ?? placeholder}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={4}
          align="start"
          collisionPadding={8}
          // Match trigger width via Radix's CSS var; cap min height so very long
          // lists scroll inside the popover instead of overflowing the viewport.
          style={{ width: "var(--radix-popover-trigger-width)" }}
          className="z-50 rounded-md border bg-popover text-popover-foreground shadow-md outline-none animate-fade-in"
          onOpenAutoFocus={(e) => {
            // Focus the search input rather than the first option
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="flex h-9 w-full bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div
            style={{ maxHeight: 240, overflowY: "auto", overscrollBehavior: "contain" }}
            className="p-1"
            // react-remove-scroll (used by the parent Dialog) calls
            // preventDefault on wheel events outside the Dialog Content tree,
            // which blocks browser-default scrolling here. preventDefault
            // does NOT stop event flow, so we still receive the wheel event
            // and translate it to scrollTop ourselves.
            onWheel={(e) => {
              e.currentTarget.scrollTop += e.deltaY;
            }}
            // Same story for touch on mobile — translate touchmove into
            // manual scrollTop updates.
            onTouchStart={(e) => {
              (e.currentTarget as HTMLDivElement & { _lastY?: number })._lastY =
                e.touches[0].clientY;
            }}
            onTouchMove={(e) => {
              const el = e.currentTarget as HTMLDivElement & { _lastY?: number };
              const lastY = el._lastY ?? e.touches[0].clientY;
              el.scrollTop += lastY - e.touches[0].clientY;
              el._lastY = e.touches[0].clientY;
            }}
          >
            {filtered.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">No results.</div>
            ) : (
              grouped.map(({ group, items }, gi) => (
                <div key={gi}>
                  {group && (
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      {group}
                    </div>
                  )}
                  {items.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => handleSelect(item.value)}
                      className={cn(
                        "relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none",
                        "hover:bg-accent hover:text-accent-foreground",
                        item.value === value && "bg-accent text-accent-foreground",
                      )}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4 shrink-0",
                          item.value === value ? "opacity-100" : "opacity-0",
                        )}
                      />
                      {item.label}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
