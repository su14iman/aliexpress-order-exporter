#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const archiver = require("archiver");

const root = path.resolve(__dirname, "..");
const distDir = path.join(root, "dist");
const keyPath = path.join(root, "key.pem");

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const slug = manifest.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const outBase = `${slug}-v${manifest.version}`;

// Only these are shipped with the extension; everything else (README, PRIVACY.md,
// package.json, scripts/, etc.) stays out of the package.
const EXTENSION_FILES = [
    "manifest.json",
    "background.js",
    "popup.html",
    "popup.js",
    "viewer.html",
    "viewer.js",
    "common.js",
    "style.css",
    "icons",
];

function stageBuild() {
    const stageDir = path.join(distDir, "build");
    fs.rmSync(stageDir, { recursive: true, force: true });
    fs.mkdirSync(stageDir, { recursive: true });

    for (const entry of EXTENSION_FILES) {
        const src = path.join(root, entry);
        if (!fs.existsSync(src)) continue;
        fs.cpSync(src, path.join(stageDir, entry), { recursive: true });
    }

    return stageDir;
}

function buildZip(stageDir) {
    fs.mkdirSync(distDir, { recursive: true });
    const outPath = path.join(distDir, `${outBase}.zip`);

    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outPath);
        const archive = archiver("zip", { zlib: { level: 9 } });

        output.on("close", () => resolve(outPath));
        archive.on("error", reject);
        archive.pipe(output);
        archive.directory(stageDir, false);
        archive.finalize();
    });
}

function getOrCreatePrivateKey() {
    if (fs.existsSync(keyPath)) {
        return fs.readFileSync(keyPath, "utf8");
    }

    const { privateKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        privateKeyEncoding: { type: "pkcs1", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
    });

    fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });
    console.log(`Generated new signing key at ${path.relative(root, keyPath)} — keep this file to preserve the extension ID across future crx builds (do not commit it).`);

    return privateKey;
}

async function buildCrx(stageDir) {
    const ChromeExtension = require("crx");
    fs.mkdirSync(distDir, { recursive: true });

    const privateKey = getOrCreatePrivateKey();
    const crx = new ChromeExtension({ privateKey });

    await crx.load(stageDir);
    const crxBuffer = await crx.pack();

    const outPath = path.join(distDir, `${outBase}.crx`);
    fs.writeFileSync(outPath, crxBuffer);

    return outPath;
}

async function main() {
    const target = process.argv[2] || "zip";
    const stageDir = stageBuild();

    if (target === "zip" || target === "all") {
        const zipPath = await buildZip(stageDir);
        console.log(`Zip created: ${path.relative(root, zipPath)}`);
    }

    if (target === "crx" || target === "all") {
        const crxPath = await buildCrx(stageDir);
        console.log(`Crx created: ${path.relative(root, crxPath)}`);
    }

    if (target !== "zip" && target !== "crx" && target !== "all") {
        console.error(`Unknown build target "${target}". Use "zip", "crx", or "all".`);
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
