#!/usr/bin/env bun
import { render } from "ink";
import { useCallback, useEffect, useState } from "react";
import { InMemoryStore } from "./adapters/memory/store";
import type { Action, AppState } from "./app/state";
import { emptyState, reduce, selectedConversation } from "./app/state";
import type { MessageStore } from "./ports/store";
import { App } from "./ui/App";

if (typeof Bun === "undefined") {
	console.error(
		"signal-tui requires the Bun runtime.\nInstall it with: curl -fsSL https://bun.sh/install | bash\nDocs: https://bun.sh/docs/installation",
	);
	process.exit(1);
}

interface RootProps {
	readonly store: MessageStore;
}

function Root({ store }: RootProps) {
	const [state, setState] = useState<AppState>(emptyState);
	const dispatch = useCallback(
		(action: Action): void => setState((current) => reduce(current, action)),
		[],
	);

	const conversationId = selectedConversation(state)?.id;

	useEffect(() => {
		let cancelled = false;
		void store.listConversations().then((conversations) => {
			if (cancelled) {
				return;
			}
			dispatch({ type: "conversations-loaded", conversations });
		});
		return () => {
			cancelled = true;
		};
	}, [store, dispatch]);

	useEffect(() => {
		if (conversationId === undefined) {
			return;
		}
		let cancelled = false;
		void store.listMessages(conversationId).then((messages) => {
			if (cancelled) {
				return;
			}
			dispatch({ type: "messages-loaded", conversationId, messages });
		});
		return () => {
			cancelled = true;
		};
	}, [store, conversationId, dispatch]);

	return <App state={state} dispatch={dispatch} />;
}

const store = new InMemoryStore();
const instance = render(<Root store={store} />);
await instance.waitUntilExit();
