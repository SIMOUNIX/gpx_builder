import {
  CalendarDays,
  ClipboardList,
  Download,
  MapPin,
  Route,
} from "lucide-react";
import { useState } from "react";
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
import { turnBlocks } from "../chat";
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

function LineView({ line }: { line: Line }) {
  if (line.kind === "tool") return <ToolTrace line={line} />;
  if (line.role === "user")
    return (
      <div className="bg-secondary ml-auto max-w-[80%] rounded-2xl px-4 py-2">
        <p className="whitespace-pre-wrap">{line.text}</p>
      </div>
    );
  return <Streamdown>{line.text}</Streamdown>;
}

/** Open while the turn runs, closed once it ends; a click always wins (`open ?? running`). */
function TurnSummary({
  title,
  running,
  children,
}: {
  title: string;
  running: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState<boolean>();
  return (
    <Trace>
      <TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine status={running ? "running" : undefined}>
            <TraceTitle>{title}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="flex flex-col gap-3">
          {children}
        </TraceCollapsibleContent>
      </TraceCollapsible>
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
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6 pb-44">
      {turnBlocks(lines, busy).map((b) =>
        b.kind === "summary" ? (
          <TurnSummary key={b.key} title={b.title} running={b.running}>
            {b.items.map((l) => (
              <LineView key={l.key} line={l} />
            ))}
          </TurnSummary>
        ) : (
          <LineView key={b.line.key} line={b.line} />
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
