import { ArrowUp } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ChatInput({
  onSend,
  placeholder,
  className,
  disabled,
}: {
  onSend: (text: string) => void;
  placeholder: string;
  className?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const send = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText("");
  };
  return (
    <div className={`bg-card relative rounded-2xl border ${className ?? ""}`}>
      <Textarea
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        className="min-h-24 resize-none border-0 bg-transparent pr-14 shadow-none focus-visible:ring-0"
      />
      <Button
        size="icon"
        className="absolute right-3 bottom-3 rounded-full"
        disabled={disabled || !text.trim()}
        onClick={send}
        aria-label="Send"
      >
        <ArrowUp />
      </Button>
    </div>
  );
}
