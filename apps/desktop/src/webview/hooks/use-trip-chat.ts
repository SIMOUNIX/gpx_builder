import { useChat } from "@ai-sdk/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport } from "ai";
import { useMemo } from "react";
import type { TripId } from "@gpx-builder/core/browser";
import { invalidateTrip, trpc } from "../api";
import { getBackend } from "../backend";
import {
  chatBody,
  historyLines,
  liveLines,
  pendingFromChat,
  pendingFromLive,
  type ChatUIMessage,
} from "../chat";

/** Stored history plus the in-flight turn. Live messages are dropped once the refetch lands, so nothing shows twice. */
export function useTripChat(tripId: TripId) {
  const qc = useQueryClient();
  const { data: stored = [] } = useQuery(
    trpc.chats.messages.queryOptions({ tripId }),
  );
  const transport = useMemo(() => {
    const { url, token } = getBackend();
    return new DefaultChatTransport<ChatUIMessage>({
      api: `${url}/api/chat`,
      headers: { authorization: `Bearer ${token}` },
      prepareSendMessagesRequest: ({ messages }) => ({
        body: chatBody(tripId, messages),
      }),
    });
  }, [tripId]);

  const chat = useChat<ChatUIMessage>({
    id: tripId,
    transport,
    onFinish: async () => {
      await invalidateTrip(qc, tripId);
      chat.setMessages([]);
    },
  });

  const busy = chat.status === "submitted" || chat.status === "streaming";
  return {
    lines: [...historyLines(stored), ...liveLines(chat.messages)],
    // A stored question must not show while the next turn runs.
    pending: busy
      ? undefined
      : (pendingFromLive(chat.messages) ?? pendingFromChat(stored)),
    busy,
    error: chat.error,
    send: (text: string) => chat.sendMessage({ text }),
  };
}
