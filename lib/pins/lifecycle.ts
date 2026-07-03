import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { parse, serialize } from "./entity.ts";

/**
 * Marks oldId as superseded by newId:
 * - Sets old entity's status to 'superseded'
 * - Adds a 'superseded_by' relation on the old entity targeting newId
 * - Writes the updated old entity back to disk
 * - Both files are preserved (old is not deleted)
 */
export async function supersede(oldId: string, newId: string, dir: string): Promise<void> {
	const oldPath = join(dir, `${oldId}.md`);
	const entity = parse(readFileSync(oldPath, "utf8"));

	entity.frontmatter.status = "superseded";
	entity.frontmatter.relations = [
		...entity.frontmatter.relations,
		{ target: newId, type: "superseded_by" },
	];

	writeFileSync(oldPath, serialize(entity), "utf8");
}

/**
 * Hard-deletes a pin file.
 * REFUSES to delete unless opts.force === true.
 * Without force, this is a no-op — the file remains untouched.
 */
export async function hardDelete(
	id: string,
	dir: string,
	opts: { force?: boolean },
): Promise<void> {
	if (!opts.force) {
		return;
	}
	unlinkSync(join(dir, `${id}.md`));
}
