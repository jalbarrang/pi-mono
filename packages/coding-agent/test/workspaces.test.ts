import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatWorkspacePreamble, formatWorkspaceStatusLine, WorkspaceController } from "../src/core/workspaces.js";

describe("WorkspaceController", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop();
			if (dir) {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	});

	it("creates, persists, and reloads a workspace with launch-cwd primary resolution", () => {
		const tempDir = join(tmpdir(), `pi-workspaces-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		tempDirs.push(tempDir);
		const workspacesDir = join(tempDir, "workspaces");
		const appDir = join(tempDir, "repos", "run-platform");
		const sdkDir = join(tempDir, "repos", "run-sdk");
		mkdirSync(appDir, { recursive: true });
		mkdirSync(sdkDir, { recursive: true });
		const resolvedAppDir = realpathSync(appDir);
		const resolvedSdkDir = realpathSync(sdkDir);

		const controller = new WorkspaceController({ workspacesDir });
		const created = controller.create("rundot", appDir);
		expect(created.name).toBe("rundot");
		expect(created.primaryFolder.basename).toBe("run-platform");
		expect(created.attachedFolders).toEqual([]);

		controller.addFolder(sdkDir);

		const workspaceFile = join(workspacesDir, "rundot.json");
		expect(existsSync(workspaceFile)).toBe(true);
		expect(JSON.parse(readFileSync(workspaceFile, "utf-8"))).toMatchObject({
			name: "rundot",
			folders: [resolvedAppDir, resolvedSdkDir],
			defaultPrimary: resolvedAppDir,
			whitelistedExtensions: [],
			whitelistedSkills: [],
		});

		const loaded = controller.load("rundot", sdkDir);
		expect(loaded.primaryFolder.path).toBe(resolvedSdkDir);
		expect(loaded.attachedFolders.map((folder) => folder.path)).toEqual([resolvedAppDir]);
		expect(controller.getActive()?.primaryFolder.path).toBe(resolvedSdkDir);
	});

	it("requires an active workspace before add-folder", () => {
		const tempDir = join(tmpdir(), `pi-workspaces-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		tempDirs.push(tempDir);
		const workspacesDir = join(tempDir, "workspaces");
		const folder = join(tempDir, "repo", "run-platform");
		mkdirSync(folder, { recursive: true });

		const controller = new WorkspaceController({ workspacesDir });
		expect(() => controller.addFolder(folder)).toThrowError(
			"No workspace loaded. Use `/workspace new <name>` first.",
		);
	});

	it("formats workspace preamble with attached folder file tag guidance", () => {
		const tempDir = join(tmpdir(), `pi-workspaces-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		tempDirs.push(tempDir);
		const workspacesDir = join(tempDir, "workspaces");
		const appDir = join(tempDir, "repos", "run-platform");
		const sdkDir = join(tempDir, "repos", "run-sdk");
		mkdirSync(appDir, { recursive: true });
		mkdirSync(sdkDir, { recursive: true });

		const controller = new WorkspaceController({ workspacesDir });
		controller.create("rundot", appDir);
		controller.addFolder(sdkDir);

		const preamble = formatWorkspacePreamble(controller.getActive()!);
		expect(preamble).toContain("`@folder-name:src/index.ts`");
		expect(preamble).toContain('`folder: "folder-name"`');
		expect(preamble).toContain("path after the colon");
	});

	it("formats a footer status line with primary marker", () => {
		const tempDir = join(tmpdir(), `pi-workspaces-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		tempDirs.push(tempDir);
		const workspacesDir = join(tempDir, "workspaces");
		const appDir = join(tempDir, "repos", "run-platform");
		const sdkDir = join(tempDir, "repos", "run-sdk");
		mkdirSync(appDir, { recursive: true });
		mkdirSync(sdkDir, { recursive: true });

		const controller = new WorkspaceController({ workspacesDir });
		controller.create("rundot", appDir);
		controller.addFolder(sdkDir);

		const status = formatWorkspaceStatusLine(controller.getActive()!);
		expect(status).toBe("ws:rundot [run-platform*, run-sdk]");
	});

	it("rejects add-folder when the basename conflicts with an existing workspace folder", () => {
		const tempDir = join(tmpdir(), `pi-workspaces-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		tempDirs.push(tempDir);
		const workspacesDir = join(tempDir, "workspaces");
		const firstDir = join(tempDir, "repos-a", "shared-name");
		const secondDir = join(tempDir, "repos-b", "shared-name");
		mkdirSync(firstDir, { recursive: true });
		mkdirSync(secondDir, { recursive: true });

		const controller = new WorkspaceController({ workspacesDir });
		controller.create("collision", firstDir);

		expect(() => controller.addFolder(secondDir)).toThrowError(/unique basenames/i);
	});
});
