import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { getWorkspacesDir } from "../config.js";

export interface WorkspaceFile {
	name: string;
	folders: string[];
	defaultPrimary: string;
	whitelistedExtensions: string[];
	whitelistedSkills: string[];
}

export interface WorkspaceFolder {
	basename: string;
	path: string;
}

export interface ActiveWorkspace {
	name: string;
	filePath: string;
	folders: WorkspaceFolder[];
	primaryFolder: WorkspaceFolder;
	attachedFolders: WorkspaceFolder[];
	defaultPrimary: string;
	whitelistedExtensions: string[];
	whitelistedSkills: string[];
}

export interface WorkspaceSummary {
	name: string;
	filePath: string;
}

export interface WorkspaceControllerOptions {
	workspacesDir?: string;
}

function ensureDirectory(dir: string): string {
	const resolved = resolve(dir);
	if (!existsSync(resolved)) {
		mkdirSync(resolved, { recursive: true });
	}
	return resolved;
}

function resolveExistingDirectory(path: string): string {
	const resolved = resolve(path);
	if (!existsSync(resolved)) {
		throw new Error(`Folder does not exist: ${path}`);
	}
	const stats = statSync(resolved);
	if (!stats.isDirectory()) {
		throw new Error(`Folder is not a directory: ${path}`);
	}
	return realpathSync(resolved);
}

function workspacePath(workspacesDir: string, name: string): string {
	return join(workspacesDir, `${name}.json`);
}

function containsPath(root: string, target: string): boolean {
	if (root === target) {
		return true;
	}
	const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
	return target.startsWith(prefix);
}

function loadRootContextFile(dir: string): { path: string; content: string } | undefined {
	for (const filename of ["AGENTS.md", "CLAUDE.md"]) {
		const filePath = join(dir, filename);
		if (existsSync(filePath)) {
			return {
				path: filePath,
				content: readFileSync(filePath, "utf-8"),
			};
		}
	}
	return undefined;
}

function resolvePrimaryPath(folders: string[], defaultPrimary: string, launchCwd: string): string {
	const normalizedLaunchCwd = existsSync(launchCwd) ? resolveExistingDirectory(launchCwd) : resolve(launchCwd);
	const launchMatch = folders.find((folder) => containsPath(folder, normalizedLaunchCwd));
	if (launchMatch) {
		return launchMatch;
	}
	const normalizedDefaultPrimary = resolveExistingDirectory(defaultPrimary);
	if (!folders.includes(normalizedDefaultPrimary)) {
		throw new Error(`defaultPrimary is not a workspace folder: ${defaultPrimary}`);
	}
	return normalizedDefaultPrimary;
}

function ensureUniqueBasenames(folders: string[]): void {
	const seen = new Map<string, string>();
	for (const folder of folders) {
		const folderBasename = basename(folder);
		const existing = seen.get(folderBasename);
		if (existing && existing !== folder) {
			throw new Error(`Workspace folders must have unique basenames. Conflict: ${folderBasename}`);
		}
		seen.set(folderBasename, folder);
	}
}

export function normalizeWorkspaceFile(workspace: WorkspaceFile): WorkspaceFile {
	const folders = workspace.folders.map((folder) => resolveExistingDirectory(folder));
	ensureUniqueBasenames(folders);
	const defaultPrimary = resolveExistingDirectory(workspace.defaultPrimary);
	if (!folders.includes(defaultPrimary)) {
		throw new Error(`defaultPrimary is not a workspace folder: ${workspace.defaultPrimary}`);
	}
	return {
		name: workspace.name,
		folders,
		defaultPrimary,
		whitelistedExtensions: workspace.whitelistedExtensions ?? [],
		whitelistedSkills: workspace.whitelistedSkills ?? [],
	};
}

export function resolveActiveWorkspace(workspace: WorkspaceFile, launchCwd: string, filePath: string): ActiveWorkspace {
	const normalized = normalizeWorkspaceFile(workspace);
	const primaryPath = resolvePrimaryPath(normalized.folders, normalized.defaultPrimary, launchCwd);
	const folders = normalized.folders.map<WorkspaceFolder>((folder) => ({
		basename: basename(folder),
		path: folder,
	}));
	const primaryFolder = folders.find((folder) => folder.path === primaryPath);
	if (!primaryFolder) {
		throw new Error(`Primary folder is not part of workspace: ${primaryPath}`);
	}
	return {
		name: normalized.name,
		filePath,
		folders,
		primaryFolder,
		attachedFolders: folders.filter((folder) => folder.path !== primaryPath),
		defaultPrimary: normalized.defaultPrimary,
		whitelistedExtensions: normalized.whitelistedExtensions,
		whitelistedSkills: normalized.whitelistedSkills,
	};
}

export function formatWorkspacePreamble(activeWorkspace: ActiveWorkspace): string {
	const lines = [
		`Workspace: ${activeWorkspace.name}`,
		"Folders:",
		...activeWorkspace.folders.map((folder) =>
			folder.path === activeWorkspace.primaryFolder.path
				? `  ${folder.basename} (primary) — ${folder.path}`
				: `  ${folder.basename} — ${folder.path}`,
		),
		"",
		"Tools accept an optional `folder` parameter. Omitting it targets the primary folder.",
		"Prefer writing to the primary folder. If the user explicitly asks you to modify files in another folder, you may do so.",
	];
	return lines.join("\n");
}

export function createWorkspaceResourceLoaderOverrides(workspaceController: Pick<WorkspaceController, "getActive">): {
	agentsFilesOverride: (base: { agentsFiles: Array<{ path: string; content: string }> }) => {
		agentsFiles: Array<{ path: string; content: string }>;
	};
	appendSystemPromptOverride: (base: string[]) => string[];
} {
	return {
		agentsFilesOverride: (base) => {
			const activeWorkspace = workspaceController.getActive();
			if (!activeWorkspace) {
				return base;
			}
			const attachedContextFiles = activeWorkspace.attachedFolders
				.map((folder) => {
					const contextFile = loadRootContextFile(folder.path);
					if (!contextFile) {
						return undefined;
					}
					return {
						path: `Context: ${folder.basename} — ${contextFile.path}`,
						content: contextFile.content,
					};
				})
				.filter((file): file is { path: string; content: string } => file !== undefined);
			return {
				agentsFiles: [...base.agentsFiles, ...attachedContextFiles],
			};
		},
		appendSystemPromptOverride: (base) => {
			const activeWorkspace = workspaceController.getActive();
			if (!activeWorkspace) {
				return base;
			}
			return [formatWorkspacePreamble(activeWorkspace), ...base];
		},
	};
}

export function formatWorkspaceStatusLine(activeWorkspace: ActiveWorkspace): string {
	const folders = activeWorkspace.folders.map((folder) =>
		folder.path === activeWorkspace.primaryFolder.path ? `${folder.basename}*` : folder.basename,
	);
	return `ws:${activeWorkspace.name} [${folders.join(", ")}]`;
}

export class WorkspaceController {
	private activeWorkspace: ActiveWorkspace | undefined;
	private readonly workspacesDir: string;

	constructor(options: WorkspaceControllerOptions = {}) {
		this.workspacesDir = ensureDirectory(options.workspacesDir ?? getWorkspacesDir());
	}

	getActive(): ActiveWorkspace | undefined {
		return this.activeWorkspace;
	}

	close(): void {
		this.activeWorkspace = undefined;
	}

	list(): WorkspaceSummary[] {
		return readdirSync(this.workspacesDir)
			.filter((entry) => entry.endsWith(".json"))
			.sort()
			.map((entry) => ({
				name: entry.slice(0, -".json".length),
				filePath: join(this.workspacesDir, entry),
			}));
	}

	create(name: string, cwd: string): ActiveWorkspace {
		const folder = resolveExistingDirectory(cwd);
		const workspace: WorkspaceFile = {
			name,
			folders: [folder],
			defaultPrimary: folder,
			whitelistedExtensions: [],
			whitelistedSkills: [],
		};
		this.write(workspace);
		const active = resolveActiveWorkspace(workspace, folder, workspacePath(this.workspacesDir, name));
		this.activeWorkspace = active;
		return active;
	}

	load(name: string, launchCwd: string): ActiveWorkspace {
		const filePath = workspacePath(this.workspacesDir, name);
		if (!existsSync(filePath)) {
			throw new Error(`Workspace not found: ${name}`);
		}
		const workspace = JSON.parse(readFileSync(filePath, "utf-8")) as WorkspaceFile;
		const active = resolveActiveWorkspace(workspace, launchCwd, filePath);
		this.activeWorkspace = active;
		return active;
	}

	addFolder(path: string): ActiveWorkspace {
		const active = this.requireActive();
		const folder = resolveExistingDirectory(path);
		const nextFolders = [...active.folders.map((entry) => entry.path), folder];
		ensureUniqueBasenames(nextFolders);
		const next: WorkspaceFile = {
			name: active.name,
			folders: Array.from(new Set(nextFolders)),
			defaultPrimary: active.defaultPrimary,
			whitelistedExtensions: [...active.whitelistedExtensions],
			whitelistedSkills: [...active.whitelistedSkills],
		};
		this.write(next);
		const resolved = resolveActiveWorkspace(next, active.primaryFolder.path, active.filePath);
		this.activeWorkspace = resolved;
		return resolved;
	}

	removeFolder(folderBasename: string): ActiveWorkspace {
		const active = this.requireActive();
		if (active.primaryFolder.basename === folderBasename) {
			throw new Error(`Cannot remove primary folder: ${folderBasename}`);
		}
		const remainingFolders = active.folders
			.filter((folder) => folder.basename !== folderBasename)
			.map((folder) => folder.path);
		if (remainingFolders.length === active.folders.length) {
			throw new Error(`Workspace folder not found: ${folderBasename}`);
		}
		const next: WorkspaceFile = {
			name: active.name,
			folders: remainingFolders,
			defaultPrimary: active.defaultPrimary,
			whitelistedExtensions: [...active.whitelistedExtensions],
			whitelistedSkills: [...active.whitelistedSkills],
		};
		this.write(next);
		const resolved = resolveActiveWorkspace(next, active.primaryFolder.path, active.filePath);
		this.activeWorkspace = resolved;
		return resolved;
	}

	resolveFolder(folderBasename?: string): WorkspaceFolder {
		const active = this.requireActive();
		if (!folderBasename) {
			return active.primaryFolder;
		}
		const folder = active.folders.find((entry) => entry.basename === folderBasename);
		if (!folder) {
			throw new Error(`Unknown workspace folder: ${folderBasename}`);
		}
		return folder;
	}

	findContaining(launchCwd: string): WorkspaceSummary[] {
		const target = existsSync(launchCwd) ? resolveExistingDirectory(launchCwd) : resolve(launchCwd);
		return this.list().filter((workspace) => {
			try {
				const parsed = JSON.parse(readFileSync(workspace.filePath, "utf-8")) as WorkspaceFile;
				const normalized = normalizeWorkspaceFile(parsed);
				return normalized.folders.some((folder) => containsPath(folder, target));
			} catch {
				return false;
			}
		});
	}

	private requireActive(): ActiveWorkspace {
		if (!this.activeWorkspace) {
			throw new Error("No workspace loaded. Use `/workspace new <name>` first.");
		}
		return this.activeWorkspace;
	}

	private write(workspace: WorkspaceFile): void {
		const normalized = normalizeWorkspaceFile(workspace);
		writeFileSync(workspacePath(this.workspacesDir, workspace.name), `${JSON.stringify(normalized, null, 2)}\n`);
	}
}
