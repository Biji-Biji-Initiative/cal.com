// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { after, test } = require("node:test");
const { compileFunction } = require("node:vm");
const sharp = require("sharp");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const sourceFile = path.join(root, "packages/lib/server/imageUtils.ts");
const compiled = ts.transpileModule(fs.readFileSync(sourceFile, "utf8"), {
  reportDiagnostics: true,
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
  },
});
assert.deepEqual(compiled.diagnostics, []);
const sourceModule = { exports: {} };
// Execute trusted repository source with the actual native decoder and no service imports.
compileFunction(compiled.outputText, ["require", "module", "exports", "console"], {
  filename: sourceFile,
})(
  (name) => {
    assert.equal(name, "sharp");
    return sharp;
  },
  sourceModule,
  sourceModule.exports,
  console
);
const { convertSvgToPng, detectContentType, resizeImage } = sourceModule.exports;
const previousConcurrency = sharp.concurrency();
sharp.concurrency(1);
after(() => sharp.concurrency(previousConcurrency));

const width = 16;
const height = 8;
const pixels = Buffer.alloc(width * height * 4);
for (let offset = 0; offset < pixels.length; offset += 4) {
  pixels[offset] = 200;
  pixels[offset + 1] = 40;
  pixels[offset + 2] = 20;
  pixels[offset + 3] = 255;
}
const image = () => sharp(pixels, { raw: { width, height, channels: 4 } });
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="8"><rect width="16" height="8" fill="#ff0000"/></svg>';
const asSvgData = (value) => `data:image/svg+xml;base64,${Buffer.from(value).toString("base64")}`;
const dataBuffer = (value) => {
  assert.ok(value.startsWith("data:image/png;base64,"));
  return Buffer.from(value.slice("data:image/png;base64,".length), "base64");
};

test("both direct owners resolve the pinned native CJS and ESM package", async () => {
  assert.equal(sharp.versions.sharp, "0.35.5");
  for (const owner of ["apps/web/package.json", "packages/lib/package.json"]) {
    const filename = path.join(root, owner);
    assert.equal(JSON.parse(fs.readFileSync(filename, "utf8")).dependencies.sharp, "0.35.5");
    assert.equal(createRequire(filename)("sharp").versions.sharp, "0.35.5");
  }
  const esm = await import("sharp");
  assert.equal(esm.default.versions.sharp, "0.35.5");
  assert.equal(typeof esm.default, "function");
});

test("the actual image helper typechecks with native bundled declarations", { timeout: 30000 }, () => {
  const configFile = path.join(root, "packages/lib/tsconfig.json");
  const config = ts.readConfigFile(configFile, ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configFile));
  assert.deepEqual(parsed.errors, []);
  const options = {
    ...parsed.options,
    types: ["node"],
    noEmit: true,
    incremental: false,
    skipLibCheck: false,
  };
  const program = ts.createProgram([sourceFile], options);
  const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) => ({
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
  }));
  assert.deepEqual(diagnostics, []);
  assert.ok(
    program
      .getSourceFiles()
      .some((file) => /sharp\/(?:dist\/index\.d\.(?:mts|cts)|lib\/index\.d\.ts)$/.test(file.fileName))
  );
});

test("avatar SVG conversion produces real PNG pixels and preserves other inputs", async () => {
  const converted = await convertSvgToPng(asSvgData(svg));
  const png = dataBuffer(converted);
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, width);
  assert.equal(metadata.height, height);
  const decoded = await sharp(png).ensureAlpha().raw().toBuffer();
  assert.deepEqual([...decoded.subarray(0, 4)], [255, 0, 0, 255]);
  const original = `data:image/png;base64,${(await image().png().toBuffer()).toString("base64")}`;
  assert.equal(await convertSvgToPng(original), original);
});

test("invalid and oversized avatar SVGs retain the transparent placeholder", async (context) => {
  let errors = 0;
  context.mock.method(console, "error", (message) => {
    assert.equal(message, "Error converting SVG to PNG");
    errors += 1;
  });
  for (const invalid of ["<svg>invalid", " ".repeat(5 * 1024 * 1024 + 1)]) {
    const fallback = dataBuffer(await convertSvgToPng(asSvgData(invalid)));
    const metadata = await sharp(fallback).metadata();
    assert.equal(metadata.width, 1);
    assert.equal(metadata.height, 1);
    assert.equal(metadata.format, "png");
    const decoded = await sharp(fallback).ensureAlpha().raw().toBuffer();
    assert.equal(decoded[3], 0);
  }
  assert.equal(errors, 2);
});

for (const [format, contentType] of [
  ["png", "image/png"],
  ["jpeg", "image/jpeg"],
  ["webp", "image/webp"],
  ["avif", "image/avif"],
]) {
  test(`native ${format} detection and resizing preserve format and dimensions`, async () => {
    const input = await image()[format]().toBuffer();
    assert.equal(await detectContentType(input), contentType);
    const resized = await resizeImage({ buffer: input, width: 8 });
    assert.equal(resized.contentType, contentType);
    const metadata = await sharp(resized.buffer).metadata();
    assert.equal(metadata.width, 8);
    assert.equal(metadata.height, 4);
    assert.equal(metadata.format, format === "avif" ? "heif" : format);
    assert.ok((await sharp(resized.buffer).raw().toBuffer()).length > 0);
  });
}

test("native AVIF metadata and decoding do not broaden acceptance to other HEIF brands", async () => {
  const avif = await image().avif().toBuffer();
  const original = await sharp(avif).metadata();
  assert.equal(original.format, "heif");
  assert.equal(original.compression, "av1");
  assert.equal(original.mediaType, "image/avif");
  assert.equal(await detectContentType(avif), "image/avif");
  const otherBrand = Buffer.from(avif);
  otherBrand.write("mif1", 8, "ascii");
  const metadata = await sharp(otherBrand).metadata();
  assert.equal(metadata.format, "heif");
  assert.equal(metadata.compression, "hevc");
  assert.equal(metadata.mediaType, "image/heic");
  assert.ok((await sharp(otherBrand).raw().toBuffer()).length > 0);
  assert.equal(await detectContentType(otherBrand), null);
});

test("native metadata fallback recognizes SVG and rejects unsupported or invalid images", async () => {
  assert.equal(await detectContentType(Buffer.from(` \n${svg}`)), "image/svg+xml");
  assert.equal(await detectContentType(await image().tiff().toBuffer()), null);
  assert.equal(await detectContentType(Buffer.from("synthetic invalid image")), null);
});

test("width-only resize avoids enlargement while explicit dimensions retain cover behavior", async () => {
  const input = await image().png().toBuffer();
  const unchanged = await resizeImage({ buffer: input, width: 64 });
  const same = await sharp(unchanged.buffer).metadata();
  assert.equal(same.width, width);
  assert.equal(same.height, height);
  const square = await resizeImage({ buffer: input, width: 12, height: 12 });
  const cropped = await sharp(square.buffer).metadata();
  assert.equal(cropped.width, 12);
  assert.equal(cropped.height, 12);
});

test("resize applies native EXIF orientation before calculating dimensions", async () => {
  const input = await image().jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const rotated = await resizeImage({ buffer: input, width: 4 });
  const metadata = await sharp(rotated.buffer).metadata();
  assert.equal(metadata.width, 4);
  assert.equal(metadata.height, 8);
  assert.equal(metadata.orientation, undefined);
});

test("unsupported declared content falls back to PNG and malformed input rejects", async () => {
  const converted = await resizeImage({
    buffer: await image().tiff().toBuffer(),
    width: 4,
    contentType: "image/tiff",
  });
  assert.equal(converted.contentType, "image/png");
  assert.equal((await sharp(converted.buffer).metadata()).format, "png");
  await assert.rejects(resizeImage({ buffer: Buffer.from("synthetic invalid image"), width: 4 }));
});
