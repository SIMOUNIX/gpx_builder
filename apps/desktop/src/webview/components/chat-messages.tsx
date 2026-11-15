import { Check, Loader2, X } from "lucide-react";
import { Streamdown } from "streamdown";
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
  busy,
  error,
  onAnswer,
}: {
  lines: Line[];
  pending: Pending | undefined;
  busy: boolean;
  error: Error | undefined;
  onAnswer: (text: string) => void;
}) {
  // The answer is just the next message: the option text, or yes/no for the export.
  const choices =
    pending?.tool === "export_trip" ? ["yes", "no"] : (pending?.options ?? []);
  // Busy and the last line is neither streaming text nor a running tool: the model is thinking silently.
  const last = lines.at(-1);
  const thinking =
    busy &&
    !(last?.kind === "tool" && last.state === "running") &&
    !(last?.kind === "text" && last.role === "assistant");
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
        ) : l.role === "user" ? (
          <div
            key={l.key}
            className="bg-secondary ml-auto max-w-[80%] rounded-2xl px-4 py-2"
          >
            <p className="whitespace-pre-wrap">{l.text}</p>
          </div>
        ) : (
          <Streamdown key={l.key}>{l.text}</Streamdown>
        ),
      )}
      {thinking && (
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          {toolIcon.running} Thinking…
        </div>
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
