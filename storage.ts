import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	applyEdit,
	DEFAULT_MODE,
	INSTRUCTIONS_ID,
	INSTRUCTIONS_MODES,
	type InstructionsEdit,
	isRecord,
	MODE_ID,
} from "./instructions";

/**
 * Persistenza di `rewrite.*` sui due livelli di impostazioni di omp: globale
 * (`~/.omp/agent/config.yml`) e progetto (`<cwd>/.omp/config.yml`). La lettura
 * usa i livelli grezzi dell'host (`getGlobalSettings`/`getProjectSettings`).
 */

/** La parte di `Settings` di omp (`pi.pi.settings`) usata da questo modulo. */
export interface HostSettings {
	getGlobalSettings(): unknown;
	getProjectSettings(): unknown;
	getCwd(): string;
	flush(): Promise<void>;
	reloadFromDisk(): Promise<void>;
}

export function projectConfigPath(cwd: string): string {
	return path.join(cwd, ".omp", "config.yml");
}

/** Mappa YAML del file; `undefined` se non esiste. Un file non valido non viene mai sovrascritto. */
async function readMapping(file: string): Promise<Record<string, unknown> | undefined> {
	let text: string;
	try {
		text = await readFile(file, "utf8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw err;
	}
	let parsed: unknown;
	try {
		parsed = text.trim() ? Bun.YAML.parse(text) : {};
	} catch (err) {
		throw new Error(`can't read ${file}: ${err instanceof Error ? err.message : String(err)}`);
	}
	if (parsed == null) return {};
	if (!isRecord(parsed)) throw new Error(`${file} is not a YAML mapping; fix it by hand first`);
	return parsed;
}

/**
 * Scrive `rewrite.*` in `<cwd>/.omp/config.yml`: l'host non scrive chiavi di progetto
 * arbitrarie. Le altre chiavi restano, ma il file viene riserializzato (i commenti si
 * perdono). Poi l'host rilegge da disco, altrimenti `getProjectSettings()` resta vecchio.
 * Restituisce il percorso del file.
 */
export async function saveProject(
	settings: Pick<HostSettings, "getCwd" | "reloadFromDisk">,
	edit: InstructionsEdit,
): Promise<string> {
	const file = projectConfigPath(settings.getCwd());
	const current = await readMapping(file);
	const next = applyEdit(current ?? {}, edit);
	const changed = current === undefined ? Object.keys(next).length > 0 : !Bun.deepEquals(current, next);
	if (changed) {
		await mkdir(path.dirname(file), { recursive: true });
		// Scrittura atomica: il file può essere versionato, un troncamento sarebbe grave.
		const temp = `${file}.${process.pid}.tmp`;
		await writeFile(temp, `${Bun.YAML.stringify(next, null, 2).trimEnd()}\n`);
		await rename(temp, file);
	}
	await settings.reloadFromDisk();
	return file;
}

type Handles = { instructions: HostSetting; mode: HostSetting };
/** Handle tipato del registry di omp: `set`/`unset` scrivono il livello globale. */
interface HostSetting {
	set(scope: unknown, value: unknown): void;
	unset(scope: unknown): void;
}

let handles: Promise<Handles> | undefined;

/** Import dinamico: il registry esiste solo dentro omp (i test non lo caricano). */
function globalHandles(): Promise<Handles> {
	handles ??= import("@oh-my-pi/pi-coding-agent/config/registry").then(({ lookup, register }) => ({
		instructions: lookup(INSTRUCTIONS_ID) ?? register({ id: INSTRUCTIONS_ID, type: "string", default: "" }),
		mode: lookup(MODE_ID) ?? register({ id: MODE_ID, type: "enum", values: INSTRUCTIONS_MODES, default: DEFAULT_MODE }),
	}));
	return handles;
}

/**
 * Scrive `rewrite.*` nel livello globale con lo store di omp (stesso percorso di
 * `/settings`, `omp config set`): `unset` toglie la chiave, così i default futuri
 * continuano ad applicarsi. `append` è il default e non viene salvato.
 */
export async function saveGlobal(settings: unknown, edit: InstructionsEdit): Promise<void> {
	const { instructions, mode } = await globalHandles();
	const text = edit.instructions?.trim();
	if (text) instructions.set(settings, text);
	else instructions.unset(settings);
	if (edit.mode && edit.mode !== DEFAULT_MODE) mode.set(settings, edit.mode);
	else mode.unset(settings);
	await (settings as Pick<HostSettings, "flush">).flush();
}
