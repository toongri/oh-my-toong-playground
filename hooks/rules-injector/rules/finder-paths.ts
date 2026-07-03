import { dirname, posix, relative, resolve } from "node:path";

export interface WalkDirectory {
	readonly directory: string;
	readonly distance: number;
}

export function getWalkDirectories(
	projectRoot: string,
	targetFile: string | null,
	cwd?: string,
): WalkDirectory[] {
	if (targetFile === null) {
		const startDirectory = cwd !== undefined ? resolve(cwd) : null;
		if (startDirectory === null || !isSameOrChildPath(startDirectory, projectRoot)) {
			return [{ directory: projectRoot, distance: 0 }];
		}
		// Walk from cwd up to projectRoot so each ancestor's rule subdirs are scanned.
		const walkDirectories: WalkDirectory[] = [];
		let currentDirectory = startDirectory;
		let distance = 0;
		while (true) {
			walkDirectories.push({ directory: currentDirectory, distance });
			if (currentDirectory === resolve(projectRoot)) {
				break;
			}
			const parentDirectory = dirname(currentDirectory);
			if (parentDirectory === currentDirectory) {
				break;
			}
			currentDirectory = parentDirectory;
			distance += 1;
		}
		return walkDirectories;
	}

	const startDirectory = dirname(resolve(targetFile));
	if (!isSameOrChildPath(startDirectory, projectRoot)) {
		return [{ directory: projectRoot, distance: 0 }];
	}

	const walkDirectories: WalkDirectory[] = [];
	let currentDirectory = startDirectory;
	let distance = 0;

	while (true) {
		walkDirectories.push({ directory: currentDirectory, distance });
		if (currentDirectory === projectRoot) {
			break;
		}

		const parentDirectory = dirname(currentDirectory);
		if (parentDirectory === currentDirectory) {
			break;
		}

		currentDirectory = parentDirectory;
		distance += 1;
	}

	return walkDirectories;
}

export function toRelativePath(rootDirectory: string, filePath: string): string {
	return posix.normalize(relative(rootDirectory, filePath).replace(/\\/g, "/"));
}

function isSameOrChildPath(childPath: string, parentPath: string): boolean {
	const childRelativePath = relative(parentPath, childPath);
	return (
		childRelativePath === "" ||
		(!childRelativePath.startsWith("..") && !childRelativePath.startsWith("/"))
	);
}
