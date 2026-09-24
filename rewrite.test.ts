import { describe, expect, test } from "bun:test";
import { MAX_QUESTIONS, parseQuestions, previewRows } from "./rewrite";

const option = (label: string) => ({ label });

describe("parseQuestions", () => {
	test("a malformed question is dropped without losing the valid ones", () => {
		const reply = JSON.stringify({
			questions: [
				{ question: "Scope?", options: [option("Module"), option("Repo")] },
				{ question: "No options" },
				{ question: "Output?", options: ["stdout", "stderr"] },
			],
		});
		expect(parseQuestions(reply)?.map(q => [q.question, q.options.map(o => o.label)])).toEqual([
			["Scope?", ["Module", "Repo"]],
			["Output?", ["stdout", "stderr"]],
		]);
	});

	test("invalid accessory fields are ignored instead of rejecting the question", () => {
		const reply = JSON.stringify({
			questions: [
				{ question: "A?", options: [option("x"), option("y")], recommended: "0", multi: "yes", header: 42 },
				{ question: "B?", options: [option("x"), option("y")], recommended: 2 },
				{ question: "C?", options: [option("x"), option("y")], recommended: 1, header: "A very long header" },
			],
		});
		expect(parseQuestions(reply)?.map(({ question, header, multi, recommended }) => ({ question, header, multi, recommended }))).toEqual([
			{ question: "A?", header: undefined, multi: false, recommended: undefined },
			{ question: "B?", header: undefined, multi: false, recommended: undefined },
			{ question: "C?", header: "A very long", multi: false, recommended: 1 },
		]);
	});

	test("reads JSON wrapped in prose or code fences", () => {
		const reply = 'Here you go:\n```json\n{"questions":[{"question":"Q?","options":["a","b"]}]}\n```';
		expect(parseQuestions(reply)?.length).toBe(1);
	});

	test(`keeps at most ${MAX_QUESTIONS} questions, with unique ids`, () => {
		const questions = Array.from({ length: MAX_QUESTIONS + 2 }, (_, i) => ({ question: `Q${i}?`, options: ["a", "b"] }));
		const parsed = parseQuestions(JSON.stringify({ questions })) ?? [];
		expect(parsed.map(q => q.question)).toEqual(["Q0?", "Q1?", "Q2?", "Q3?"]);
		expect(new Set(parsed.map(q => q.id)).size).toBe(MAX_QUESTIONS);
	});

	test("distinguishes 'no questions needed' from an unreadable reply", () => {
		expect(parseQuestions('{"questions":[]}')).toEqual([]);
		expect(parseQuestions("The draft is clear.")).toBeUndefined();
		expect(parseQuestions('{"questions": "none"}')).toBeUndefined();
	});
});

describe("previewRows", () => {
	test("follows the tail of a line longer than the width", () => {
		const rows = previewRows(`${"word ".repeat(40)}LATEST`, 20, 3);
		expect(rows.at(-1)).toEndWith("LATEST");
		expect(rows).toHaveLength(3);
		for (const row of rows) expect(row.length).toBeLessThanOrEqual(20);
	});

	test("hard-wraps a long token with no spaces", () => {
		expect(previewRows("x".repeat(45), 20, 8)).toEqual(["x".repeat(20), "x".repeat(20), "x".repeat(5)]);
	});

	test("keeps only the last rows across lines", () => {
		expect(previewRows("1\n2\n3\n4\n", 20, 2)).toEqual(["3", "4"]);
	});
});
