import type { Conversation, Message } from "../../domain/types";

const base = Date.parse("2026-10-22T10:00:00Z");
const minutes = (count: number): number => base + count * 60_000;

export const demoConversations: readonly Conversation[] = [
	{ id: "c-signal-devs", name: "Signal devs", unreadCount: 2, lastActivityAt: minutes(42) },
	{ id: "c-alice", name: "Alice", unreadCount: 0, lastActivityAt: minutes(31) },
	{ id: "c-family", name: "Family", unreadCount: 7, lastActivityAt: minutes(12) },
	{ id: "c-note-to-self", name: "Note to self", unreadCount: 0, lastActivityAt: minutes(4) },
];

export const demoMessages: readonly Message[] = [
	{
		id: "m-1",
		conversationId: "c-signal-devs",
		author: "Adam",
		body: "pushed the fix, ptal",
		sentAt: minutes(1),
		isOutgoing: false,
		isDeleted: false,
	},
	{
		id: "m-2",
		conversationId: "c-signal-devs",
		author: "You",
		body: "on it, testing now",
		sentAt: minutes(2),
		isOutgoing: true,
		isDeleted: false,
		// So `--demo` shows both tick states without an account: read here, delivered below.
		receipt: "read",
	},
	{
		id: "m-3",
		conversationId: "c-signal-devs",
		author: "Marta",
		body: "attachments path also needs the 4 MiB limit",
		sentAt: minutes(3),
		isOutgoing: false,
		isDeleted: false,
		// Two people agreeing, so the demo shows a counted marker.
		reactions: [
			{ emoji: "👍", author: "Adam", authorId: "uuid-adam" },
			{ emoji: "👍", author: "You", authorId: "self" },
		],
	},
	{
		id: "m-4",
		conversationId: "c-alice",
		author: "Alice",
		body: "can we ship before friday?",
		sentAt: minutes(5),
		isOutgoing: false,
		isDeleted: false,
	},
	{
		id: "m-5",
		conversationId: "c-alice",
		author: "You",
		body: "depends on the audio routing test",
		sentAt: minutes(6),
		isOutgoing: true,
		isDeleted: false,
		receipt: "delivered",
	},
	{
		id: "m-6",
		conversationId: "c-family",
		author: "Mum",
		body: "dinner at 7?",
		sentAt: minutes(7),
		isOutgoing: false,
		isDeleted: false,
	},
	{
		id: "m-7",
		conversationId: "c-family",
		author: "You",
		body: "works for me",
		sentAt: minutes(8),
		isOutgoing: true,
		isDeleted: true,
	},
	{
		id: "m-9",
		conversationId: "c-signal-devs",
		author: "Marta",
		body: "",
		sentAt: minutes(4),
		isOutgoing: false,
		isDeleted: false,
		attachments: [
			{
				id: "a-1",
				contentType: "image/png",
				filename: "/home/you/.local/share/signal-cli/attachments/screenshot-limit.png",
				size: 412_000,
				caption: "the 4 MiB limit, measured",
				isVoiceNote: false,
			},
			{
				id: "a-2",
				contentType: "audio/ogg",
				filename: null,
				size: 61_440,
				caption: null,
				isVoiceNote: true,
			},
		],
	},
	{
		id: "m-8",
		conversationId: "c-note-to-self",
		author: "You",
		body: "FTS5 index before v0.1",
		sentAt: minutes(9),
		isOutgoing: true,
		isDeleted: false,
	},
	{
		id: "m-view-once",
		conversationId: "c-family",
		author: "Mum",
		body: "",
		sentAt: minutes(7),
		isOutgoing: false,
		isDeleted: false,
		// What a view-once message leaves behind: a row with no text and no files.
		isViewOnce: true,
	},
	{
		id: "m-10",
		conversationId: "c-signal-devs",
		author: "Adam",
		body: "that is exactly why the loop is chunked",
		sentAt: minutes(5),
		isOutgoing: false,
		isDeleted: false,
		// A reply: the quoted text is not stored, only which message it answers, so
		// `--demo` shows the quote block resolving against the thread above it.
		quote: { sentAt: minutes(3), authorId: "uuid-marta" },
	},
];
