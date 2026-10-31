// Copies manifest, HTML, CSS and icons from static/ into dist/.
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });
cpSync("static", "dist", { recursive: true });
console.log("Copied static assets to dist/");
