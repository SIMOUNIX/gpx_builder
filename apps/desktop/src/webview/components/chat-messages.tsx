import {
  CalendarDays,
  ClipboardList,
  Download,
  MapPin,
  Route,
  Sparkles,
} from "lucide-react";
import { Streamdown } from "streamdown";
import { Button } from "@/components/ui/button";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import type { Line, Pending } from "../chat";
import { traceOf } from "../trace";

const icons = { MapPin, Route, ClipboardList, CalendarDays, Download };

function ToolTrace({ line }: { line: Extract<Line, { kind: "tool" }> }) {
  const row = traceOf(line);
  if (!row) return null;
  const Icon = icons[row.icon];
  const status =
    line.state === "ok"
      ? undefined
      : line.state === "failed"
        ? "error"
        : "running";
  const content = (
    <TraceLine status={status}>
      <TraceIcon>
        <Icon />
      </TraceIcon>
      <TraceTitle>{row.title}</TraceTitle>
    </TraceLine>
  );
  return (
    <Trace>
      {row.detail.length === 0 ? (
        content
      ) : (
        <TraceCollapsible>
          <TraceCollapsibleTrigger>{content}</TraceCollapsibleTrigger>
          <TraceCollapsibleContent>
            {row.detail.map((d, i) => (
              <p key={i}>{d}</p>
            ))}
          </TraceCollapsibleContent>
        </TraceCollapsible>
      )}
    </Trace>
  );
}

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
          <ToolTrace key={l.key} line={l} />
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
        <Trace>
          <TraceLine status="running">
            <TraceIcon>
              <Sparkles />
            </TraceIcon>
            <TraceTitle>Thinking…</TraceTitle>
          </TraceLine>
        </Trace>
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
