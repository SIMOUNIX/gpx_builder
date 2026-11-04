import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  ChatId,
  ChatMessage,
  err,
  ok,
  type ChatStorePort,
  type Result,
  type StoreError,
} from "@gpx-builder/core/server";
import { writeFileAtomic } from "./atomic";
import { ioError } from "./io-error";

/** One JSONL line. Every line carries `v`. */
const ChatLine = z.object({ v: z.literal(1), message: ChatMessage });

function parseLine(line: string): ChatMessage | undefined {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return undefined;
  }
  const parsed = ChatLine.safeParse(json);
  return parsed.success ? parsed.data.message : undefined;
}

type Inspected =
  | { messages: ChatMessage[]; fixedText?: string; cutTail?: string }
  | { badLine: number };

/**
 * Appends write a whole line plus "\n" in one call, so a crash can only leave
 * an unterminated last line. That tail is either a complete message missing
 * its newline (kept, newline added) or a torn one (cut off, copy saved). A
 * damaged line that does end in "\n" is not a crash artifact: `badLine`.
 */
function inspect(text: string): Inspected {
  const lines = text.split("\n");
  const tail = lines.pop() ?? ""; // "" when the text ends with a newline
  const messages: ChatMessage[] = [];
  for (const [i, line] of lines.entries()) {
    const message = parseLine(line);
    if (!message) {
      return { badLine: i + 1 };
    }
    messages.push(message);
  }
  if (tail === "") {
    return { messages };
  }
  const terminated = lines.length > 0 ? `${lines.join("\n")}\n` : "";
  const last = parseLine(tail);
  if (last) {
    return {
      messages: [...messages, last],
      fixedText: `${terminated}${tail}\n`,
    };
  }
  return { messages, fixedText: terminated, cutTail: tail };
}

export function createChatStore(opts: {
  dataDir: string;
  /** The clock, injected so tests control quarantine names. */
  now?: () => Date;
}): ChatStorePort {
  const chatsDir = join(opts.dataDir, "chats");
  const quarantineDir = join(opts.dataDir, "quarantine");
  const now = opts.now ?? (() => new Date());

  const fileOf = (id: ChatId) => join(chatsDir, `${id}.jsonl`);

  /** Quarantined copies of this chat (cut-off tails are `.tail` files and don't count). */
  const quarantinedFiles = (id: ChatId): string[] =>
    existsSync(quarantineDir)
      ? readdirSync(quarantineDir)
          .filter((n) => n.startsWith(`${id}.`) && n.endsWith(".jsonl"))
          .map((n) => join(quarantineDir, n))
      : [];

  /** `<chatId>.<timestamp><ext>` in quarantine/, never overwriting an earlier file. */
  const quarantinePath = (id: ChatId, ext: string): string => {
    mkdirSync(quarantineDir, { recursive: true });
    const stamp = now().toISOString().replace(/[:.]/g, "-");
    let path = join(quarantineDir, `${id}.${stamp}${ext}`);
    for (let n = 1; existsSync(path); n++) {
      path = join(quarantineDir, `${id}.${stamp}-${n}${ext}`);
    }
    return path;
  };

  const quarantinedError = (id: ChatId, paths: string[]): StoreError => ({
    kind: "corrupt",
    message: `chat ${id} was quarantined (${paths.join(", ")}); start a new chat`,
    path: paths[0],
  });

  /** Reads the chat, repairing a torn tail. A damaged line moves the file to quarantine/. */
  function read(id: ChatId): Result<ChatMessage[], StoreError> {
    const file = fileOf(id);
    if (!existsSync(file)) {
      const q = quarantinedFiles(id);
      return err(
        q.length > 0
          ? quarantinedError(id, q)
          : { kind: "not-found", message: `no chat ${id}` },
      );
    }
    const inspected = inspect(readFileSync(file, "utf8"));
    if ("badLine" in inspected) {
      const dest = quarantinePath(id, ".jsonl");
      renameSync(file, dest);
      return err({
        kind: "corrupt",
        message: `line ${inspected.badLine} of chat ${id} is damaged; the file was moved to ${dest}`,
        path: dest,
      });
    }
    // Copy the cut-off part aside first, so nothing is dropped silently.
    if (inspected.cutTail !== undefined) {
      writeFileAtomic(quarantinePath(id, ".tail"), inspected.cutTail);
    }
    if (inspected.fixedText !== undefined) {
      writeFileAtomic(file, inspected.fixedText);
    }
    return ok(inspected.messages);
  }

  return {
    append(chatId, message) {
      if (!ChatId.safeParse(chatId).success) {
        return err({ kind: "invalid", message: `bad chat id ${chatId}` });
      }
      const parsed = ChatMessage.safeParse(message);
      if (!parsed.success) {
        return err({ kind: "invalid", message: z.prettifyError(parsed.error) });
      }
      try {
        const q = quarantinedFiles(chatId);
        if (q.length > 0) return err(quarantinedError(chatId, q));
        const file = fileOf(chatId);
        if (existsSync(file)) {
          const repaired = read(chatId); // fixes a torn tail before we append
          if (!repaired.ok) return repaired;
        }
        mkdirSync(chatsDir, { recursive: true });
        const fd = openSync(file, "a");
        try {
          writeFileSync(
            fd,
            `${JSON.stringify({ v: 1, message: parsed.data })}\n`,
          );
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        return ok(undefined);
      } catch (e) {
        return err(ioError(e, chatsDir));
      }
    },

    load(chatId) {
      if (!ChatId.safeParse(chatId).success) {
        return err({ kind: "invalid", message: `bad chat id ${chatId}` });
      }
      try {
        return read(chatId);
      } catch (e) {
        return err(ioError(e, chatsDir));
      }
    },
  };
}
