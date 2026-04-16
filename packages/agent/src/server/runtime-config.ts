import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { Effect, Option, Schema } from "effect";

const RuntimeConfigSchema = Schema.Struct({
  default_model: Schema.optional(Schema.String),
});

export type RuntimeConfig = typeof RuntimeConfigSchema.Type;

export class RuntimeConfigError extends Schema.TaggedErrorClass<RuntimeConfigError>()(
  "RuntimeConfigError",
  {
    message: Schema.String,
  },
) {}

const configRoot = () =>
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "agents");

const configFiles = (dir: string) => [
  join(configRoot(), "config.json"),
  join(configRoot(), "config.jsonc"),
  join(dir, ".agents", "config.json"),
  join(dir, ".agents", "config.jsonc"),
];

const charAt = (text: string, index: number) => text[index] ?? "";

const stripComments = (text: string) => {
  let out = "";
  let mode: "code" | "string" | "line" | "block" = "code";

  for (let i = 0; i < text.length; i++) {
    const cur = charAt(text, i);
    const next = charAt(text, i + 1);

    switch (mode) {
      case "string": {
        out += cur;
        const escaped = Number(cur === "\\" && next !== "");
        out += next.repeat(escaped);
        i += escaped;
        if (escaped === 1) continue;
        mode = ["string", "code"][Number(cur === '"')] as
          | "string"
          | "code";
        continue;
      }
      case "line": {
        const isNewline = Number(cur === "\n");
        out += cur.repeat(isNewline);
        mode = ["line", "code"][isNewline] as "line" | "code";
        continue;
      }
      case "block": {
        const isBlockEnd = Number(cur === "*" && next === "/");
        i += isBlockEnd;
        mode = ["block", "code"][isBlockEnd] as "block" | "code";
        continue;
      }
      case "code": {
        const isQuote = Number(cur === '"');
        out += cur.repeat(isQuote);
        mode = ["code", "string"][isQuote] as "code" | "string";
        if (isQuote === 1) continue;

        const lineCommentStart = Number(cur === "/" && next === "/");
        i += lineCommentStart;
        mode = ["code", "line"][lineCommentStart] as "code" | "line";
        if (lineCommentStart === 1) continue;

        const blockCommentStart = Number(cur === "/" && next === "*");
        i += blockCommentStart;
        mode = ["code", "block"][blockCommentStart] as "code" | "block";
        if (blockCommentStart === 1) continue;

        out += cur;
      }
    }
  }

  return out;
};

const stripTrailing = (text: string) => {
  let out = "";
  let mode: "code" | "string" = "code";

  for (let i = 0; i < text.length; i++) {
    const cur = charAt(text, i);

    switch (mode) {
      case "string": {
        out += cur;
        const escaped = Number(cur === "\\" && i + 1 < text.length);
        out += charAt(text, i + 1).repeat(escaped);
        i += escaped;
        if (escaped === 1) continue;
        mode = ["string", "code"][Number(cur === '"')] as "string" | "code";
        continue;
      }
      case "code": {
        const isQuote = Number(cur === '"');
        out += cur.repeat(isQuote);
        mode = ["code", "string"][isQuote] as "code" | "string";
        if (isQuote === 1) continue;

        const isComma = Number(cur === ",");
        let j = i + isComma;
        while (j < text.length && isComma === 1 && /\s/.test(charAt(text, j))) {
          j += 1;
        }
        const next = charAt(text, j);
        const shouldSkipTrailingComma = Number(
          isComma === 1 && (next === "}" || next === "]"),
        );

        out += cur.repeat(1 - shouldSkipTrailingComma);
      }
    }
  }

  return out;
};

const parse = Effect.fn("RuntimeConfig.parse")(function* (
  text: string,
  file: string,
) {
  return yield* Effect.try({
    try: () =>
      Schema.decodeUnknownSync(RuntimeConfigSchema)(
        JSON.parse(stripTrailing(stripComments(text))),
      ),
    catch: () =>
      new RuntimeConfigError({
        message: `Failed to parse config: ${file}`,
      }),
  });
});

const isFileNotFoundError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "ENOENT";

const readFailure = (file: string) =>
  new RuntimeConfigError({
    message: `Failed to read config: ${file}`,
  });

const missingConfigError = new RuntimeConfigError({ message: "" });

const handleLoadFileError = (file: string, error: unknown) =>
  [readFailure(file), missingConfigError][Number(isFileNotFoundError(error))] ??
  readFailure(file);

const recoverLoadFileError = (error: RuntimeConfigError) =>
  [Effect.fail(error), Effect.succeed(Option.none<string>())][
    Number(error.message === "")
  ] ??
  Effect.fail(error);

const loadFile = Effect.fn("RuntimeConfig.loadFile")(function* (file: string) {
  const text = yield* Effect.tryPromise({
    try: () => readFile(file, "utf8"),
    catch: (error): RuntimeConfigError => handleLoadFileError(file, error),
  }).pipe(
    Effect.map(Option.some),
    Effect.catchTag("RuntimeConfigError", recoverLoadFileError),
  );

  return yield* Option.match(text, {
    onNone: () => Effect.succeed({} satisfies RuntimeConfig),
    onSome: (contents) => parse(contents, file),
  });
});

export const loadRuntimeConfig = Effect.fn("RuntimeConfig.load")(function* (
  dir: string,
) {
  let cfg: RuntimeConfig = {};

  for (const file of configFiles(dir)) {
    cfg = { ...cfg, ...(yield* loadFile(file)) };
  }

  return cfg;
});
