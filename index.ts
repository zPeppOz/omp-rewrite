import type {
	ExtensionAPI,
	ExtensionAskDialogQuestion,
	ExtensionCommandContext,
} from "@oh-my-pi/pi-coding-agent";
import { type Answer, parseQuestions, previewRows, questionsPrompt, rewritePrompt } from "./rewrite";

/**
 * /rewrite <bozza>
 *
 * Side turn stile /btw: usa il contesto della sessione corrente e non scrive nulla
 * nella history. Flusso: domande di direzione (0–4) → riscrittura → composer.
 */

const WIDGET_KEY = "rewrite";
const PREVIEW_ROWS = 8;
// Al più un aggiornamento del widget ogni 100 ms: in RPC ogni aggiornamento è un frame sul canale.
const PREVIEW_INTERVAL_MS = 100;
// Esc legacy e con kitty keyboard protocol.
const ESCAPE = /^\x1b(\[27(;1)?u)?$/;
// Prima versione di omp con ctx.runEphemeralTurn per le estensioni.
const MIN_OMP_VERSION = "18.3.0";
const CANCELLED = "/rewrite: cancelled; draft restored to the composer";

type RunEphemeralTurn = NonNullable<ExtensionCommandContext["runEphemeralTurn"]>;

/** Mostra le domande; `undefined` = l'utente ha annullato. */
async function askQuestions(
	ctx: ExtensionCommandContext,
	questions: ExtensionAskDialogQuestion[],
): Promise<Answer[] | undefined> {
	if (ctx.ui.askDialog) {
		const result = await ctx.ui.askDialog(questions);
		if (result?.kind !== "submit") return undefined;
		return result.results.flatMap(r => {
			const parts = [...r.selectedOptions, r.customInput?.trim()].filter(Boolean);
			if (r.note?.trim()) parts.push(`(note: ${r.note.trim()})`);
			return parts.length ? [{ question: r.question, answer: parts.join("; ") }] : [];
		});
	}

	// Host senza ask dialog (es. RPC): una select per domanda + risposta libera.
	// Le domande multi accettano una sola scelta; l'opzione consigliata è indicata nella descrizione.
	const OTHER = "Other…";
	const answers: Answer[] = [];
	for (const q of questions) {
		const options = q.options.map((o, i) =>
			i === q.recommended ? { label: o.label, description: o.description ? `Recommended. ${o.description}` : "Recommended" } : o,
		);
		const choice = await ctx.ui.select(q.question, [...options, { label: OTHER, description: "Free-form answer" }]);
		if (choice === undefined) return undefined;
		const answer = choice === OTHER ? await ctx.ui.input(q.question, "Free-form answer") : choice;
		if (answer === undefined) return undefined;
		if (answer.trim()) answers.push({ question: q.question, answer: answer.trim() });
	}
	return answers;
}

/**
 * Side turn con widget di avanzamento sopra il composer; Esc annulla (solo TUI).
 * `undefined` = annullato dall'utente.
 */
async function sideTurn(
	ctx: ExtensionCommandContext,
	runEphemeralTurn: RunEphemeralTurn,
	label: string,
	promptText: string,
	{ preview }: { preview: boolean },
): Promise<string | undefined> {
	const { theme } = ctx.ui;
	// Esc arriva all'estensione solo nella TUI: altrove il suggerimento sarebbe falso.
	const header = theme.fg("accent", `✎ /rewrite · ${label}`) + (ctx.mode === "tui" ? theme.fg("muted", "  (Esc to cancel)") : "");
	let streamed = "";
	let lastRender = 0;
	const render = () => {
		const lines = [header];
		if (streamed.trim()) {
			const width = Math.max(20, (process.stdout.columns ?? 100) - 4);
			for (const row of previewRows(streamed, width, PREVIEW_ROWS)) lines.push(theme.fg("muted", row));
		}
		ctx.ui.setWidget(WIDGET_KEY, lines, { placement: "aboveEditor" });
	};

	const controller = new AbortController();
	const unsubscribe = ctx.ui.onTerminalInput(data => {
		if (!ESCAPE.test(data)) return undefined;
		controller.abort();
		return { consume: true };
	});
	render();
	try {
		const { replyText } = await runEphemeralTurn({
			promptText,
			signal: controller.signal,
			onTextDelta: preview
				? delta => {
						streamed += delta;
						const now = Date.now();
						if (now - lastRender < PREVIEW_INTERVAL_MS) return;
						lastRender = now;
						render();
					}
				: undefined,
		});
		// Esc premuto mentre il turno si chiudeva: vale comunque come annullamento.
		return controller.signal.aborted ? undefined : replyText;
	} catch (err) {
		if (controller.signal.aborted) return undefined;
		throw err;
	} finally {
		unsubscribe();
		ctx.ui.setWidget(WIDGET_KEY, undefined);
	}
}

/** Mette il testo nel composer senza cancellare quello che l'utente ha scritto nel frattempo. */
function putInComposer(ctx: ExtensionCommandContext, text: string): void {
	const current = ctx.ui.getEditorText();
	ctx.ui.setEditorText(current.trim() ? `${current.trimEnd()}\n\n${text}` : text);
}

/** Domande → riscrittura → composer. Su annullamento o errore la bozza torna nel composer. */
async function rewrite(ctx: ExtensionCommandContext, runEphemeralTurn: RunEphemeralTurn, draft: string): Promise<void> {
	const restore = (message: string, type: "info" | "error") => {
		putInComposer(ctx, draft);
		ctx.ui.notify(message, type);
	};
	try {
		const analysis = await sideTurn(ctx, runEphemeralTurn, "analyzing the draft", questionsPrompt(draft), {
			preview: false,
		});
		if (analysis === undefined) return restore(CANCELLED, "info");

		const questions = parseQuestions(analysis);
		if (!questions) ctx.ui.notify("/rewrite: couldn't read the model's questions; rewriting without them", "warning");

		let answers: Answer[] = [];
		if (questions?.length) {
			const answered = await askQuestions(ctx, questions);
			if (!answered) return restore(CANCELLED, "info");
			answers = answered;
		}

		const rewritten = await sideTurn(ctx, runEphemeralTurn, "rewriting the prompt", rewritePrompt(draft, answers), {
			preview: true,
		});
		if (rewritten === undefined) return restore(CANCELLED, "info");
		if (!rewritten.trim()) throw new Error("the model returned an empty rewrite");

		putInComposer(ctx, rewritten.trim());
		ctx.ui.notify("/rewrite: prompt rewritten into the composer; review it and press Enter", "info");
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		restore(`/rewrite: failed (${reason}); draft restored to the composer`, "error");
	}
}

export default function rewriteExtension(pi: ExtensionAPI) {
	let busy = false;

	pi.registerCommand("rewrite", {
		description: "Rewrite a draft into a thorough prompt, asking about its direction first (/btw-style side turn)",
		handler: async (args, ctx) => {
			// Senza UI (print/json) non c'è composer dove consegnare il risultato: fallire subito, prima di chiamare il modello.
			if (!ctx.hasUI) throw new Error("/rewrite: needs an interactive UI (TUI or RPC); the result goes to the composer");
			const runEphemeralTurn = ctx.runEphemeralTurn;
			if (!runEphemeralTurn) {
				ctx.ui.notify(`/rewrite: requires omp ${MIN_OMP_VERSION} or newer (side turns for extensions)`, "error");
				return;
			}
			if (busy) {
				ctx.ui.notify("/rewrite: already running", "warning");
				return;
			}

			busy = true;
			try {
				let draft = args.trim();
				if (!draft) {
					const typed = await ctx.ui.editor("Draft prompt to rewrite");
					// Editor chiuso con Esc: annullamento esplicito, nessun avviso.
					if (typed === undefined) return;
					draft = typed.trim();
				}
				if (!draft) {
					ctx.ui.notify("/rewrite: empty draft; usage: /rewrite <draft>", "warning");
					return;
				}
				await rewrite(ctx, runEphemeralTurn, draft);
			} finally {
				busy = false;
			}
		},
	});
}
