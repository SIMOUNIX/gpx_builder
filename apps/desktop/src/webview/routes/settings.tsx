import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useThemeStore } from "../hooks/use-theme";
import { THEMES } from "../theme";

export function SettingsPage() {
  const navigate = useNavigate();
  const { theme, setTheme } = useThemeStore();
  return (
    <main className="mx-auto max-w-xl space-y-8 p-8">
      <Button
        variant="ghost"
        size="icon"
        className="rounded-full"
        aria-label="Back"
        onClick={() => navigate({ to: "/" })}
      >
        <ArrowLeft />
      </Button>
      <h1 className="font-serif text-4xl italic">Settings</h1>
      <section className="space-y-3">
        <h2 className="caps text-muted-foreground">Appearance</h2>
        <div role="radiogroup" aria-label="Theme" className="flex gap-2">
          {THEMES.map((t) => (
            <Button
              key={t}
              role="radio"
              aria-checked={theme === t}
              variant={theme === t ? "default" : "outline"}
              className="rounded-full capitalize"
              onClick={() => setTheme(t)}
            >
              {t}
            </Button>
          ))}
        </div>
      </section>
    </main>
  );
}
