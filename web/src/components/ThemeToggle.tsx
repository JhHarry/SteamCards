import { Monitor, Moon, Sun } from "lucide-react";
import type { Theme } from "../lib/theme";

const OPTIONS = [
  { value: "light", label: "亮色主题", icon: Sun },
  { value: "dark", label: "暗色主题", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
] as const;

interface ThemeToggleProps {
  theme: Theme;
  onChange: (theme: Theme) => void;
}

export default function ThemeToggle({ theme, onChange }: ThemeToggleProps) {
  return (
    <div className="theme-switch" role="group" aria-label="外观主题">
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            title={option.label}
            aria-label={option.label}
            aria-pressed={theme === option.value}
            data-active={theme === option.value}
            onClick={() => onChange(option.value)}
          >
            <Icon size={14} strokeWidth={2.1} />
          </button>
        );
      })}
    </div>
  );
}
