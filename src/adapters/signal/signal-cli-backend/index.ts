import type { ConversationId } from "../../../domain/types";
import type {
	BackendEvent,
	ReactionTarget,
	ReceiptType,
	ReplyTarget,
	SendResult,
	SignalBackend,
} from "../../../ports/backend";
import { reactionParams, receiptParams, sendParams } from "../commands";
import { mapEnvelope } from "../map-envelope";
import { receiveEnvelopeSchema } from "../schemas";
import { ProtocolErrorLog } from "./error-log";
import { eventsFrom, groupConversationOf, unwrapNotification } from "./events";
import { DEFAULT_NOTIFICATION_METHOD, type RpcCaller, type SignalCliBackendOptions } from "./types";

/**
 * `signal-cli` over JSON-RPC: the app's `SignalBackend`, and nothing else.
 *
 * This class owns the lifecycle (subscribe, unsubscribe, close), the wire calls, and the
 * group bookkeeping that decides how a send is addressed. What an envelope *means* is
 * `map-envelope`'s job, what the app *hears* is `events.ts`'s, and the payload shapes are
 * `commands.ts`'s — so this file reads as a list of operations rather than a protocol.
 */
export class SignalCliBackend implements SignalBackend {
	readonly #client: RpcCaller;
	readonly #account: string;
	readonly #notificationMethod: string;

	#listeners = new Set<(event: BackendEvent) => void>();
	#unsubscribe: (() => void) | null = null;
	#subscription: number | null = null;
	/** Group conversations seen so far, so replies use `groupId` instead of `recipient`. */
	#groupIds = new Set<ConversationId>();
	#errors = new ProtocolErrorLog();

	constructor(client: RpcCaller, options: SignalCliBackendOptions) {
		this.#client = client;
		this.#account = options.account;
		this.#notificationMethod = options.notificationMethod ?? DEFAULT_NOTIFICATION_METHOD;
	}

	/** Messages that failed validation or could not be mapped. Bounded to the last 20. */
	get protocolErrors(): readonly string[] {
		return this.#errors.entries;
	}

	async start(): Promise<void> {
		if (this.#unsubscribe !== null) {
			return;
		}

		const unsubscribe = this.#client.onNotification((method, params) => {
			this.#handleNotification(method, params);
		});

		try {
			const subscription = await this.#client.request<unknown>("subscribeReceive");
			if (typeof subscription !== "number") {
				// A peer that answers without an id would leave start() "successful" but unable
				// to retry or unsubscribe; fail inside the cleanup path.
				throw new Error(
					`subscribeReceive returned ${typeof subscription}, expected a subscription id`,
				);
			}
			this.#subscription = subscription;
			this.#unsubscribe = unsubscribe;
		} catch (error) {
			// Startup failed: leave no handler behind, so a retry can really retry.
			unsubscribe();
			this.#subscription = null;
			throw error;
		}
	}

	async stop(): Promise<void> {
		const unsubscribe = this.#unsubscribe;
		this.#unsubscribe = null;
		unsubscribe?.();

		if (this.#subscription !== null) {
			const subscription = this.#subscription;
			this.#subscription = null;
			try {
				await this.#client.request("unsubscribeReceive", { subscription });
			} catch {
				// Best effort: the child may already be gone.
			}
		}

		this.#client.close("backend stopped");
	}

	async sendMessage(
		conversationId: ConversationId,
		body: string,
		replyTo?: ReplyTarget,
	): Promise<SendResult> {
		const params = sendParams({
			conversationId,
			body,
			isGroup: this.#groupIds.has(conversationId),
			account: this.#account,
			replyTo,
		});
		const result = await this.#client.request<{ timestamp?: unknown } | undefined>("send", params);
		const timestamp = result?.timestamp;
		return { timestamp: typeof timestamp === "number" ? timestamp : undefined };
	}

	async sendReceipt(
		recipient: ConversationId,
		timestamps: readonly number[],
		type: ReceiptType = "read",
	): Promise<void> {
		if (timestamps.length === 0) {
			return;
		}
		await this.#client.request("sendReceipt", receiptParams(recipient, timestamps, type));
	}

	async sendReaction(
		conversationId: ConversationId,
		target: ReactionTarget,
		emoji: string,
		isRemove = false,
	): Promise<void> {
		const params = reactionParams({
			conversationId,
			target,
			emoji,
			isRemove,
			isGroup: this.#groupIds.has(conversationId),
			account: this.#account,
		});
		await this.#client.request("sendReaction", params);
	}

	subscribe(listener: (event: BackendEvent) => void): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	#handleNotification(method: string, params: unknown): void {
		if (method !== this.#notificationMethod) {
			return;
		}

		const parsed = receiveEnvelopeSchema.safeParse(unwrapNotification(params));
		if (!parsed.success) {
			this.#errors.record(`invalid envelope: ${parsed.error.issues[0]?.message ?? "unknown"}`);
			return;
		}

		const mapped = mapEnvelope(parsed.data.envelope);
		const groupId = groupConversationOf(mapped);
		if (groupId !== null) {
			this.#groupIds.add(groupId);
		}

		for (const event of eventsFrom(mapped)) {
			this.#emit(event);
		}
	}

	#emit(event: BackendEvent): void {
		for (const listener of this.#listeners) {
			listener(event);
		}
	}
}

export { ProtocolErrorLog } from "./error-log";
export { eventsFrom, groupConversationOf, unwrapNotification } from "./events";
export {
	DEFAULT_NOTIFICATION_METHOD,
	type RpcCaller,
	type SignalCliBackendOptions,
} from "./types";
