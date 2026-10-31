// Builds a clean dist/ and zips its contents into release/ for the Chrome Web Store.
// manifest.json sits at the root of the zip, as the store requires. No dependencies.
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { deflateRawSync } from "node:zlib";

// Refuse to package a store build that can't take payments.
const config = readFileSync("src/config.ts", "utf8");
const problems = [
  [/DODO_MODE = "live"/, 'set DODO_MODE to "live"'],
  [/DODO_PRODUCT_ID = "[^"]+"/, "fill in DODO_PRODUCT_ID"],
  [/CHECKOUT_URL = "https:\/\/[^"]+"/, "fill in CHECKOUT_URL"],
].filter(([pattern]) => !pattern.test(config));
if (problems.length > 0) {
  console.error(`Not packaging: in src/config.ts, ${problems.map(([, fix]) => fix).join(", ")}.`);
  process.exit(1);
}

rmSync("dist", { recursive: true, force: true });
execSync("npm run build", { stdio: "inherit" });

const { version } = JSON.parse(readFileSync("dist/manifest.json", "utf8"));
const out = `release/blockthenoise-${version}.zip`;

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Fixed DOS timestamp (2026-01-01 00:00) keeps builds byte-for-byte reproducible.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

const locals = [];
const centrals = [];
let offset = 0;

for (const file of listFiles("dist").sort()) {
  const name = Buffer.from(relative("dist", file).split("\\").join("/"));
  const data = readFileSync(file);
  const compressed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  locals.push(local, name, compressed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); // version made by
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, name);

  offset += local.length + name.length + compressed.length;
}

const centralDir = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(centrals.length / 2, 8);
end.writeUInt16LE(centrals.length / 2, 10);
end.writeUInt32LE(centralDir.length, 12);
end.writeUInt32LE(offset, 16);

mkdirSync("release", { recursive: true });
writeFileSync(out, Buffer.concat([...locals, centralDir, end]));
console.log(`Packaged ${centrals.length / 2} files into ${out}`);
