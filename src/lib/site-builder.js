import fs from "node:fs";
import path from "node:path";

import { DEV_DIR, PRODUCTION_DIR, STATE_DIR } from "./constants.js";
import { runCmd, safeRemoveDir } from "./helpers.js";
import { getGitHubToken } from "./github.js";

export function serveStaticSite(dir, req, res) {
  const reqPath = decodeURIComponent(req.path);
  const filePath = path.join(
    dir,
    reqPath === "/" ? "index.html" : reqPath,
  );

  if (reqPath === "/" || reqPath === "/index.html") {
    const indexExists = fs.existsSync(filePath);
    const dirContents = fs.existsSync(dir)
      ? fs.readdirSync(dir).slice(0, 10)
      : [];
    console.log(`[static] Serving ${reqPath} from ${dir}`);
    console.log(
      `[static] Index exists: ${indexExists}, Dir contents: ${dirContents.join(", ")}`,
    );
  }

  if (!filePath.startsWith(dir)) {
    return res.status(403).send("Forbidden");
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return res.sendFile(filePath);
  }
  const dirIndexPath = path.join(filePath, "index.html");
  if (
    fs.existsSync(dirIndexPath) &&
    fs.statSync(dirIndexPath).isFile()
  ) {
    return res.sendFile(dirIndexPath);
  }
  const htmlPath = filePath + ".html";
  if (fs.existsSync(htmlPath) && fs.statSync(htmlPath).isFile()) {
    return res.sendFile(htmlPath);
  }
  const notFoundPath = path.join(dir, "404.html");
  if (fs.existsSync(notFoundPath)) {
    return res.status(404).sendFile(notFoundPath);
  }
  const placeholderPath = path.join(
    process.cwd(),
    "src",
    "public",
    "placeholder.html",
  );
  if (fs.existsSync(placeholderPath)) {
    return res.status(200).sendFile(placeholderPath);
  }

  // SPA catch-all: serve index.html for client-side routes
  // This handles direct URL access to routes like /about, /blog/post, etc.
  // that are handled by the SPA's client-side router
  const indexPath = path.join(dir, "index.html");
  if (fs.existsSync(indexPath)) {
    // Don't serve index.html for API paths, static assets, or files with extensions
    const isApiPath = reqPath.startsWith("/api/") || reqPath.startsWith("/_astro/");
    const isStaticAsset = path.extname(reqPath) !== "" && !reqPath.endsWith(".html");
    if (!isApiPath && !isStaticAsset) {
      console.log(`[static] SPA catch-all: serving index.html for ${reqPath}`);
      return res.sendFile(indexPath);
    }
  }

  return res.status(404).send("Not found");
}

export async function autoSaveDevChanges() {
  try {
    const gitDir = path.join(DEV_DIR, ".git");
    if (!fs.existsSync(DEV_DIR) || !fs.existsSync(gitDir)) {
      console.log("[auto-save] DEV_DIR not a git repo, skipping auto-save");
      return { ok: true, saved: false };
    }

    const status = await runCmd("git", ["status", "--porcelain"], {
      cwd: DEV_DIR,
    });
    if (status.code !== 0) {
      console.error(`[auto-save] git status failed: ${status.output}`);
      return { ok: false, error: status.output };
    }

    const hasChanges = status.output.trim().length > 0;
    if (!hasChanges) {
      console.log("[auto-save] No uncommitted changes, skipping auto-save");
      return { ok: true, saved: false };
    }

    console.log("[auto-save] Uncommitted changes detected, saving...");

    await runCmd("git", ["config", "user.email", "gerald@illumin8.ca"], {
      cwd: DEV_DIR,
    });
    await runCmd("git", ["config", "user.name", "Gerald"], { cwd: DEV_DIR });

    const add = await runCmd("git", ["add", "-A"], { cwd: DEV_DIR });
    if (add.code !== 0) {
      console.error(`[auto-save] git add failed: ${add.output}`);
      return { ok: false, error: add.output };
    }

    const timestamp = new Date()
      .toISOString()
      .replace("T", " ")
      .substring(0, 19);
    const commitMsg = `auto-save: dev site changes (${timestamp})`;
    const commit = await runCmd("git", ["commit", "-m", commitMsg], {
      cwd: DEV_DIR,
    });
    if (commit.code !== 0) {
      console.error(`[auto-save] git commit failed: ${commit.output}`);
      return { ok: false, error: commit.output };
    }

    let devBranch = "development";
    try {
      const illumin8ConfigPath = path.join(STATE_DIR, "illumin8.json");
      if (fs.existsSync(illumin8ConfigPath)) {
        const config = JSON.parse(
          fs.readFileSync(illumin8ConfigPath, "utf8"),
        );
        devBranch = config.devBranch || "development";
      } else {
        const githubConfigPath = path.join(STATE_DIR, "github.json");
        if (fs.existsSync(githubConfigPath)) {
          const config = JSON.parse(
            fs.readFileSync(githubConfigPath, "utf8"),
          );
          devBranch = config.devBranch || "development";
        }
      }
    } catch (e) {
      console.warn(
        `[auto-save] Could not read config, using default branch: ${e.message}`,
      );
    }

    const token = getGitHubToken();
    if (token) {
      const remoteResult = await runCmd(
        "git",
        ["remote", "get-url", "origin"],
        { cwd: DEV_DIR },
      );
      if (remoteResult.code === 0) {
        const originalUrl = remoteResult.output.trim();
        const cleanUrl = originalUrl.replace(/https:\/\/.*?@/, "https://");
        const authUrl = cleanUrl.replace(
          "https://",
          `https://x-access-token:${token}@`,
        );
        await runCmd("git", ["remote", "set-url", "origin", authUrl], {
          cwd: DEV_DIR,
        });
      }
    }

    console.log(`[auto-save] Pushing to ${devBranch}...`);
    const push = await runCmd("git", ["push", "origin", devBranch], {
      cwd: DEV_DIR,
    });

    if (token) {
      const remoteResult = await runCmd(
        "git",
        ["remote", "get-url", "origin"],
        { cwd: DEV_DIR },
      );
      if (remoteResult.code === 0) {
        const authUrl = remoteResult.output.trim();
        const cleanUrl = authUrl.replace(/https:\/\/.*?@/, "https://");
        await runCmd("git", ["remote", "set-url", "origin", cleanUrl], {
          cwd: DEV_DIR,
        });
      }
    }

    if (push.code !== 0) {
      console.error(`[auto-save] git push failed: ${push.output}`);
      return { ok: true, saved: true, pushed: false, error: push.output };
    }

    console.log(`[auto-save] ✓ Saved and pushed changes to ${devBranch}`);
    return { ok: true, saved: true, pushed: true };
  } catch (err) {
    console.error(`[auto-save] Unexpected error: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

export async function cloneAndBuild(
  repoUrl,
  branch,
  targetDir,
  token,
  opts = {},
) {
  const { keepSource = false } = opts;
  await safeRemoveDir(targetDir);
  fs.mkdirSync(targetDir, { recursive: true });

  const authUrl = token
    ? repoUrl.replace("https://", `https://x-access-token:${token}@`)
    : repoUrl;

  console.log(
    `[build] Cloning ${repoUrl} branch=${branch} into ${targetDir}`,
  );
  let clone = await runCmd("git", [
    "clone",
    "--depth",
    "1",
    "--branch",
    branch,
    authUrl,
    targetDir,
  ]);
  if (clone.code !== 0) {
    if (
      clone.output.includes("not found") ||
      clone.output.includes("Could not find remote branch")
    ) {
      console.log(
        `[build] Branch '${branch}' not found, creating from default branch...`,
      );
      await safeRemoveDir(targetDir);
      fs.mkdirSync(targetDir, { recursive: true });

      clone = await runCmd("git", [
        "clone",
        "--depth",
        "1",
        authUrl,
        targetDir,
      ]);
      if (clone.code === 0) {
        await runCmd("git", ["checkout", "-b", branch], { cwd: targetDir });
        await runCmd("git", ["push", "origin", branch], { cwd: targetDir });
        console.log(`[build] Created branch '${branch}' from default`);
      } else {
        console.error(`[build] Clone failed: ${clone.output}`);
        return { ok: false, output: clone.output };
      }
    } else {
      console.error(`[build] Clone failed: ${clone.output}`);
      return { ok: false, output: clone.output };
    }
  }

  const packageJsonPath = path.join(targetDir, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    const cleanEnv = {
      ...process.env,
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/home/linuxbrew/.linuxbrew/bin",
      ESBUILD_BINARY_PATH: "",
    };

    if (keepSource) {
      console.log(
        `[build] Dev mode: installing dependencies (full install)...`,
      );
      const install = await runCmd("npm", ["install"], {
        cwd: targetDir,
        env: cleanEnv,
      });
      if (install.code !== 0) {
        console.error(`[build] npm install failed: ${install.output}`);
        return { ok: false, output: install.output };
      }

      if (token) {
        const remoteResult = await runCmd(
          "git",
          ["remote", "get-url", "origin"],
          { cwd: targetDir },
        );
        if (remoteResult.code === 0) {
          const cleanUrl = remoteResult.output
            .trim()
            .replace(/https:\/\/.*?@/, "https://");
          await runCmd("git", ["remote", "set-url", "origin", cleanUrl], {
            cwd: targetDir,
          });
        }
      }

      console.log(
        `[build] Dev source ready: ${targetDir} (branch: ${branch})`,
      );
      return {
        ok: true,
        output: `Cloned source from ${branch} branch (dev mode — ready for npm run dev)`,
      };
    }

    console.log(`[build] Installing dependencies (--ignore-scripts)...`);
    const install = await runCmd("npm", ["install", "--ignore-scripts"], {
      cwd: targetDir,
      env: cleanEnv,
    });
    if (install.code !== 0) {
      console.error(`[build] npm install failed: ${install.output}`);
      return { ok: false, output: install.output };
    }

    const { execSync } = await import("child_process");
    try {
      const esbuildDirs = execSync(
        `find ${targetDir}/node_modules -name "install.js" -path "*/esbuild/*" -not -path "*/node_modules/*/node_modules/*/node_modules/*"`,
        { encoding: "utf8", env: cleanEnv },
      )
        .trim()
        .split("\n")
        .filter(Boolean);

      for (const installScript of esbuildDirs) {
        const esbuildDir = path.dirname(installScript);
        console.log(
          `[build] Running esbuild install in ${path.relative(targetDir, esbuildDir)}...`,
        );
        const binPath = path.join(esbuildDir, "bin", "esbuild");
        try {
          fs.unlinkSync(binPath);
        } catch {}
        await runCmd("node", ["install.js"], {
          cwd: esbuildDir,
          env: cleanEnv,
        });
      }
    } catch (e) {
      console.log(
        `[build] esbuild re-install: ${e.message || "no esbuild found (OK)"}`,
      );
    }

    console.log(`[build] Running build...`);
    const build = await runCmd("npm", ["run", "build"], {
      cwd: targetDir,
      env: cleanEnv,
    });
    if (build.code !== 0) {
      console.error(`[build] Build failed: ${build.output}`);
      return { ok: false, output: build.output };
    }

    const possibleDirs = [
      "dist",
      "dist/client",
      ".vercel/output/static",
      ".output/public",
      "build",
      "out",
      "_site",
      "public",
    ];
    let outputDir = null;
    for (const dir of possibleDirs) {
      const fullPath = path.join(targetDir, dir);
      if (
        fs.existsSync(fullPath) &&
        fs.existsSync(path.join(fullPath, "index.html"))
      ) {
        outputDir = fullPath;
        console.log(`[build] Found output directory: ${dir}`);
        break;
      }
    }
    if (!outputDir) {
      for (const dir of possibleDirs) {
        const fullPath = path.join(targetDir, dir);
        if (
          fs.existsSync(fullPath) &&
          fs.statSync(fullPath).isDirectory()
        ) {
          outputDir = fullPath;
          console.log(
            `[build] Found output directory (no index.html): ${dir}`,
          );
          break;
        }
      }
    }

    if (outputDir && outputDir !== targetDir) {
      const tmpDir = targetDir + "_built";
      await safeRemoveDir(tmpDir);
      fs.renameSync(outputDir, tmpDir);
      await safeRemoveDir(targetDir);
      fs.renameSync(tmpDir, targetDir);
      console.log(`[build] Moved build output to ${targetDir}`);
    }

    console.log(`[build] Build complete: ${targetDir}`);
    return { ok: true, output: `Built successfully from ${branch} branch` };
  }

  return { ok: true, output: `Cloned static site from ${branch} branch` };
}

export async function pullDevBranch() {
  const githubConfigPath = path.join(STATE_DIR, "github.json");
  if (!fs.existsSync(githubConfigPath))
    return { ok: false, output: "No github config" };

  const githubConfig = JSON.parse(
    fs.readFileSync(githubConfigPath, "utf8"),
  );
  const token = getGitHubToken();
  const repoUrl = `https://github.com/${githubConfig.repo}`;
  const authUrl = token
    ? repoUrl.replace("https://", `https://x-access-token:${token}@`)
    : repoUrl;

  if (fs.existsSync(path.join(DEV_DIR, ".git"))) {
    console.log("[dev-server] Pulling latest changes...");
    await runCmd("git", ["remote", "set-url", "origin", authUrl], {
      cwd: DEV_DIR,
    });
    const pull = await runCmd(
      "git",
      ["pull", "--ff-only", "origin", githubConfig.devBranch],
      { cwd: DEV_DIR },
    );
    if (pull.code !== 0) {
      console.log("[dev-server] Pull failed, doing hard reset...");
      await runCmd("git", ["fetch", "origin", githubConfig.devBranch], {
        cwd: DEV_DIR,
      });
      await runCmd(
        "git",
        ["reset", "--hard", `origin/${githubConfig.devBranch}`],
        { cwd: DEV_DIR },
      );
    }
    await runCmd("npm", ["install"], { cwd: DEV_DIR });
    return { ok: true, output: "Pulled and updated" };
  } else {
    console.log("[dev-server] Fresh clone for dev server...");
    await safeRemoveDir(DEV_DIR);
    fs.mkdirSync(DEV_DIR, { recursive: true });
    const clone = await runCmd("git", [
      "clone",
      "--branch",
      githubConfig.devBranch,
      authUrl,
      DEV_DIR,
    ]);
    if (clone.code !== 0) return { ok: false, output: clone.output };
    await runCmd("npm", ["install"], { cwd: DEV_DIR });
    return { ok: true, output: "Cloned fresh" };
  }
}
