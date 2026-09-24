import { expect, test } from "bun:test";
import catalog from "./.omp-plugin/marketplace.json";
import pkg from "./package.json";

// `omp plugin upgrade` confronta solo la `version` del catalogo: se resta indietro
// rispetto a package.json, gli utenti del marketplace non ricevono l'aggiornamento.
test("the marketplace entry tracks package.json", () => {
	const entry = catalog.plugins.find(p => p.name === pkg.name);
	expect(entry?.version).toBe(pkg.version);
});
