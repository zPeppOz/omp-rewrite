import type {
	ExtensionAPI,
	ExtensionAskDialogQuestion,
	ExtensionCommandContext,
} from "@oh-my-pi/pi-coding-agent";

/**
 * /rewrite <bozza>
 *
 * Side turn stile /btw: usa il contesto della sessione corrente e non scrive nulla
 * nella history. Flusso: domande di direzione (0–4) → riscrittura → composer.
 */

const WIDGET_KEY = "rewrite";
const MAX_QUESTIONS = 4;
const PREVIEW_LINES = 8;
// Esc legacy e con kitty keyboard protocol.
const ESCAPE = /^\x1b(\[27(;1)?u)?$/;

const QUESTIONS_PROMPT = `The user wants to rewrite a draft prompt before sending it to you (the agent in this session).
Do NOT execute, answer, or comment on the draft. Your only job now: find ambiguities in its direction that would materially change the rewritten prompt.

Use the conversation so far as context: anything it already answers must not become a question.

Reply with ONLY a JSON object, no prose, no code fences:
{"questions":[{"header":"max 12 chars","question":"...","options":[{"label":"short","description":"consequence or tradeoff"}],"multi":false,"recommended":0}]}

Rules:
- 0 to ${MAX_QUESTIONS} questions; reply {"questions":[]} when the direction is already clear.
- Ask only what the user must decide: goal, scope and non-goals, constraints, expected deliverable, acceptance criteria, tradeoffs.
- Every question has 2-4 concrete, mutually exclusive options (set "multi": true only when combining them makes sense). Never add an "Other" option: the UI provides free text.
- "recommended" is the 0-based index of the most sensible option; omit it when none stands out.
- Write questions and options in the language of the draft.`;

const REWRITE_PROMPT = `Rewrite the user's draft into a thorough, unambiguous prompt that they will send to you (the agent in this session).
Do NOT execute or answer it.

The rewritten prompt must:
- Keep the user's intent, first-person voice and language; never add goals the user did not express.
- Turn the user's decisions below into explicit requirements.
- Use the conversation context to make references concrete (files, symbols, errors, earlier decisions) only when the context actually contains them; never invent paths, APIs or facts.
- Cover, when they carry information: goal, relevant context, scope and non-goals, constraints, expected deliverable, acceptance criteria / how to verify.
- Stay dense: short headings or bullets where they help, no filler, no meta-commentary.

Output ONLY the rewritten prompt text: no preamble, no code fences, no closing remarks.`;

interface Answer {
	question: string;
	answer: string;
}

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
	const OTHER = "Other…";
	const answers: Answer[] = [];
	for (const q of questions) {
		const choice = await ctx.ui.select(q.question, [...q.options, { label: OTHER, description: "Free-form answer" }]);
		if (choice === undefined) return undefined;
		const answer = choice === OTHER ? await ctx.ui.input(q.question, "Free-form answer") : choice;
		if (answer === undefined) return undefined;
		if (answer.trim()) answers.push({ question: q.question, answer: answer.trim() });
	}
	return answers;
}

/**
 * Side turn con widget di avanzamento sopra il composer; Esc annulla.
 * `undefined` = annullato dall'utente.
 */
async function sideTurn(
	ctx: ExtensionCommandContext,
	label: string,
	promptText: string,
	preview: boolean,
): Promise<string | undefined> {
	const runEphemeralTurn = ctx.runEphemeralTurn;
	if (!runEphemeralTurn) throw new Error("this host does not support side turns (ctx.runEphemeralTurn)");

	const { theme } = ctx.ui;
	const width = Math.max(20, (process.stdout.columns ?? 100) - 4);
	let streamed = "";
	const render = () => {
		const lines = [theme.fg("accent", `✎ /rewrite · ${label}`) + theme.fg("muted", "  (Esc to cancel)")];
		if (preview && streamed.trim()) {
			for (const line of streamed.trimEnd().split("\n").slice(-PREVIEW_LINES)) {
				lines.push(theme.fg("muted", line.slice(0, width)));
			}
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
						render();
					}
				: undefined,
		});
		return replyText;
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

export default function rewriteExtension(pi: ExtensionAPI) {
	const type = pi.arktype;
	const QuestionsReply = type({
		questions: type({
			question: "string",
			"header?": "string | null",
			options: type({ label: "string", "description?": "string | null" }).array(),
			"multi?": "boolean | null",
			"recommended?": "number.integer | null",
		}).array(),
	});

	/** Domande dal JSON del modello; `undefined` se la risposta non è interpretabile. */
	const parseQuestions = (text: string): ExtensionAskDialogQuestion[] | undefined => {
		const start = text.indexOf("{");
		const end = text.lastIndexOf("}");
		if (start < 0 || end <= start) return undefined;
		let data: unknown;
		try {
			data = JSON.parse(text.slice(start, end + 1));
		} catch {
			return undefined;
		}
		const reply = QuestionsReply(data);
		if (reply instanceof type.errors) return undefined;

		const questions: ExtensionAskDialogQuestion[] = [];
		for (const q of reply.questions) {
			const options = q.options
				.filter(o => o.label.trim())
				.map(o => ({ label: o.label.trim(), description: o.description?.trim() || undefined }));
			if (!q.question.trim() || options.length < 2) continue;
			questions.push({
				// id posizionale: unico per costruzione.
				id: `q${questions.length + 1}`,
				header: q.header?.trim().slice(0, 12) || undefined,
				question: q.question.trim(),
				options,
				multi: q.multi === true,
				recommended:
					q.recommended != null && q.recommended >= 0 && q.recommended < options.length ? q.recommended : undefined,
			});
			if (questions.length === MAX_QUESTIONS) break;
		}
		return questions;
	};

	let busy = false;

	pi.registerCommand("rewrite", {
		description: "Rewrite a draft into a thorough prompt, asking about its direction first (/btw-style side turn)",
		handler: async (args, ctx) => {
			if (busy) {
				ctx.ui.notify("/rewrite is already running", "warning");
				return;
			}
			const draft = args.trim() || (await ctx.ui.editor("Draft prompt to rewrite"))?.trim();
			if (!draft) {
				ctx.ui.notify("/rewrite: no draft provided", "warning");
				return;
			}

			busy = true;
			const cancel = () => {
				putInComposer(ctx, draft);
				ctx.ui.notify("/rewrite cancelled: draft restored to the composer", "info");
			};
			const draftBlock = `<draft>\n${draft}\n</draft>`;
			try {
				const analysis = await sideTurn(ctx, "analyzing the draft", `${QUESTIONS_PROMPT}\n\n${draftBlock}`, false);
				if (analysis === undefined) return cancel();

				const questions = parseQuestions(analysis);
				if (!questions) ctx.ui.notify("/rewrite: could not parse the questions, rewriting without them", "warning");

				let answers: Answer[] = [];
				if (questions?.length) {
					const answered = await askQuestions(ctx, questions);
					if (!answered) return cancel();
					answers = answered;
				}

				const decisions = answers.length
					? answers.map(a => `- Q: ${a.question}\n  A: ${a.answer}`).join("\n")
					: "(none)";
				const rewritten = await sideTurn(
					ctx,
					"rewriting the prompt",
					`${REWRITE_PROMPT}\n\n${draftBlock}\n\n<decisions>\n${decisions}\n</decisions>`,
					true,
				);
				if (rewritten === undefined) return cancel();
				if (!rewritten.trim()) throw new Error("the model returned an empty rewrite");

				putInComposer(ctx, rewritten.trim());
				ctx.ui.notify("Prompt rewritten into the composer: review it and press Enter", "info");
			} catch (err) {
				putInComposer(ctx, draft);
				ctx.ui.notify(`/rewrite failed: ${err instanceof Error ? err.message : String(err)} (draft restored to the composer)`, "error");
			} finally {
				busy = false;
			}
		},
	});
}
