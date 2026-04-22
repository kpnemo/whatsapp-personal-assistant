import { Check, Monitor, Moon, Sun } from "lucide-react";
import type { JSX } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useTheme, type Theme } from "./theme-provider";

interface Option {
  value: Theme;
  label: string;
  Icon: typeof Sun;
}

const OPTIONS: Option[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

export function ThemeToggle(): JSX.Element {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const TriggerIcon = resolvedTheme === "dark" ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Toggle theme"
        className="inline-flex size-9 items-center justify-center rounded-md border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <TriggerIcon className="size-4" aria-hidden="true" />
        <span className="sr-only">Toggle theme</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[8rem]">
        {OPTIONS.map(({ value, label, Icon }) => {
          const active = theme === value;
          return (
            <DropdownMenuItem
              key={value}
              data-active={active}
              onSelect={() => {
                setTheme(value);
              }}
              className="flex items-center gap-2"
            >
              <Icon className="size-4" aria-hidden="true" />
              <span className={active ? "font-medium" : undefined}>{label}</span>
              {active ? <Check className="ml-auto size-4" aria-hidden="true" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
