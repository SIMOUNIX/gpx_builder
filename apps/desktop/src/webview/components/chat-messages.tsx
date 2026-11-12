import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Line, Pending } from "../chat";

const toolIcon = {
  running: <Loader2 className="size-3 animate-spin" />,
  ok: <Check className="size-3" />,
  failed: <X className="text-destructive size-3" />,
};

export function ChatMessages({
  lines,
  pending,
  error,
  onAnswer,
}: {
  lines: Line[];
  pending: Pending | undefined;
  error: Error | undefined;
  onAnswer: (text: string) => void;
}) {
  // The answer is just the next message: the option text, or yes/no for the export.
  const choices =
    pending?.tool === "export_trip" ? ["yes", "no"] : (pending?.options ?? []);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6 pb-44">
      {lines.map((l) =>
        l.kind === "tool" ? (
          <div
            key={l.key}
            className="text-muted-foreground flex items-center gap-2 text-xs"
          >
            {toolIcon[l.state]} {l.name}
          </div>
        ) : (
          <div
            key={l.key}
            className={
              l.role === "user"
                ? "bg-secondary ml-auto max-w-[80%] rounded-2xl px-4 py-2"
                : "max-w-[80%]"
            }
          >
            <p className="whitespace-pre-wrap">{l.text}</p>
          </div>
        ),
      )}
      {pending?.tool === "export_trip" && <p>Export the GPX files?</p>}
      {choices.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {choices.map((c) => (
            <Button
              key={c}
              variant="outline"
              size="sm"
              onClick={() => onAnswer(c)}
            >
              {c}
            </Button>
          ))}
        </div>
      )}
      {error && <p className="text-destructive text-sm">{error.message}</p>}
    </div>
  );
}
