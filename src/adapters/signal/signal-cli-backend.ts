import type { ConversationId } from "../../domain/types";
import type {
	BackendEvent,
	ReactionTarget,
	ReceiptType,
	ReplyTarget,
	SendResult,
	SignalBackend,
} from "../../ports/backend";
import { reactionParams, receiptParams, sendParams } from "./commands";
import { mapEnvelope } from "./map-envelope";
import { receiveEnvelopeSchema } from "./schemas";

/**
 * The slice of {@link JsonRpcClient} this adapter needs. Narrow on purpose: tests
 * pass a fake, and the real client satisfies it structurally.
 */
export interface RpcCaller {
	request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T>;
	onNotification(handler: (method: string, params: unknown) => void): () => void;
	close(reason?: string): void;
}

export interface SignalCliBackendOptions {
	/** Account to act as, e.g. "+48123456789". */
	readonly account: string;
	/** JSON-RPC notification method carrying envelopes. signal-cli uses "receive". */
	readonly notificationMethod?: string;
}

const DEFAULT_NOTIFICATION_METHOD = "receive";
const MAX_PROTOCOL_ERRORS = 20;

/**
 * signal-cli wraps notifications differently per receive mode: automatic mode
 * sends `params.envelope`, manual mode (the default here) sends
 * `params.result.envelope` inside a subscription envelope. Both must parse.
 */
export function unwrapNotification(params: unknown): unknown {
	if (typeof params !== "object" || params === null) {
		return params;
	}
	const result = (params as { result?: unknown }).result;
	if (typeof result === "object" && result !== null && "envelope" in result) {
		return result;
	}
	return params;
}

export class SignalCliBackend implements SignalBackend {
	readonly #client: RpcCaller;
	readonly #account: string;
	readonly #notificationMethod: string;

	#listeners = new Set<(event: BackendEvent) => void>();
	#unsubscribe: (() => void) | null = null;
	#subscription: number | null = null;
	/** Group conversations seen so far, so replies use `groupId` instead of `recipient`. */
	#groupIds = new Set<ConversationId>();
	#protocolErrors: string[] = [];

	constructor(client: RpcCaller, options: SignalCliBackendOptions) {
		this.#client = client;
		this.#account = options.account;
		this.#notificationMethod = options.notificationMethod ?? DEFAULT_NOTIFICATION_METHOD;
	}

	/** Messages that failed validation or could not be mapped. Bounded to the last 20. */
	get protocolErrors(): readonly string[] {
		return this.#protocolErrors;
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
				// A peer that answers without an id would leave start() "successful"
				// but unable to retry or unsubscribe; fail inside the cleanup path.
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
			this.#recordProtocolError(
				`invalid envelope: ${parsed.error.issues[0]?.message ?? "unknown"}`,
			);
			return;
		}

		const mapped = mapEnvelope(parsed.data.envelope);
		// Every event that names a conversation counts, reactions included: a reaction can
		// be the first thing this session sees from a group, and `#groupIds` is what decides
		// whether a later send addresses the group by id or by a recipient that is not one.
		const conversationId =
			mapped.conversation?.id ??
			mapped.deleted?.conversationId ??
			mapped.edited?.conversationId ??
			mapped.reaction?.conversationId;
		if (mapped.conversationKind === "group" && conversationId !== undefined) {
			this.#groupIds.add(conversationId);
		}

		if (mapped.conversation !== null) {
			this.#emit({ kind: "conversation-updated", conversation: mapped.conversation });
		}
		if (mapped.message !== null) {
			this.#emit({ kind: "message", message: mapped.message });
		}
		if (mapped.edited !== null) {
			this.#emit({
				kind: "message-edited",
				conversationId: mapped.edited.conversationId,
				targetSentAt: mapped.edited.targetSentAt,
				editor: mapped.edited.editor,
				body: mapped.edited.body,
			});
		}
		if (mapped.deleted !== null) {
			this.#emit({
				kind: "message-deleted",
				conversationId: mapped.deleted.conversationId,
				messageId: mapped.deleted.messageId,
			});
		}
		if (mapped.reaction !== null) {
			this.#emit({
				kind: "reaction",
				conversationId: mapped.reaction.conversationId,
				targetSentAt: mapped.reaction.targetSentAt,
				reactor: mapped.reaction.reactor,
				emoji: mapped.reaction.emoji,
				isRemove: mapped.reaction.isRemove,
			});
		}
		if (mapped.receipt !== null) {
			this.#emit({
				kind: "receipt",
				timestamps: mapped.receipt.timestamps,
				state: mapped.receipt.state,
			});
		}
	}

	#recordProtocolError(message: string): void {
		this.#protocolErrors.push(message);
		if (this.#protocolErrors.length > MAX_PROTOCOL_ERRORS) {
			this.#protocolErrors.shift();
		}
	}

	#emit(event: BackendEvent): void {
		for (const listener of this.#listeners) {
			listener(event);
		}
	}
}
