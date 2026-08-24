import { readdirSync, readFileSync, statSync } from "fs";
import { basename, join, relative } from "path";

/**
 * A device type or a firmware threshold, in the order the code reaches it. The
 * order is what ties the two together: a family's decision function tests a
 * device type and then compares the firmware against the threshold that type
 * is routed on.
 */
export type CodeEvent =
  | { kind: "type"; value: string }
  | { kind: "threshold"; value: number };

/**
 * "These device types are routed on this firmware number." Types is empty when
 * a threshold applies to the whole family rather than to a named type — the
 * first-firmware-line comparison most families start with.
 */
export interface RoutingRule {
  types: string[];
  threshold: number;
}

/** Facts extracted from one method's disassembly. */
export interface MethodFacts {
  /** Path under the app package, e.g. `pages/.../jupiter_version_controller.dart`. */
  file: string;
  className: string;
  method: string;
  /** Firmware thresholds: floating-point constants the code compares against. */
  thresholds: number[];
  /**
   * Small integers compared against. Dart tags small integers by doubling them,
   * so a comparison against 6 is a comparison with 3 — a three-character
   * version string, for instance. Both forms are kept: the raw value is what
   * the code holds, the untagged one is what it means.
   */
  intCompares: Array<{ raw: number; untagged: number }>;
  /** Short string literals — device types and version prefixes, not log text. */
  literals: string[];
  /** Callees, as `<library path>#<Class>::<method>`. */
  calls: string[];
  /** Device types and thresholds in code order, for {@link deriveRules}. */
  events: CodeEvent[];
}

/** A routing decision, with everything it delegates to folded in. */
export interface DecisionSite extends MethodFacts {
  /** Which axis this decides. */
  axis: "broker" | "topic-id";
  /** Methods whose facts were folded in, in the order they were reached. */
  resolvedThrough: string[];
  /** Which device types are routed on which threshold. */
  rules: RoutingRule[];
}

/**
 * Entry points: the app asks these when it is about to talk to a device. Each
 * family answers them its own way — some inline, most by delegating to a
 * per-family version controller, which is why the walk below follows calls.
 */
const ENTRY_POINTS: Record<string, DecisionSite["axis"]> = {
  isUseNewCertificate: "broker",
  isSupportMqttEncrypt: "broker",
  isSupportNewMqttCertificate: "broker",
  _isUseNewMqttServer: "broker",
  isSupportVid: "topic-id",
  isSupportSetVid: "topic-id",
};

/** Utility code that every branch reaches and that decides nothing. */
const UNINTERESTING = /common_print|Manager|CommonPrint|_log/u;

const APP_PACKAGE_PREFIX = "package:cross_power_x/";
/**
 * How far to follow delegation. A family typically reaches its numbers through
 * strategy -> controller -> per-model strategy, so three hops.
 */
const MAX_DEPTH = 3;

/**
 * A literal shaped like a device type or type prefix — `HMA`, `HME-2`,
 * `TPM-CN`, `SMR-`. The other literals a decision function holds are generation
 * digits and separators used to pick a type apart, which guard nothing on their
 * own.
 */
export function isDeviceType(literal: string): boolean {
  return (
    /^[A-Z]{2,5}(?:\d|-|-[A-Z\d]+)*$/u.test(literal) &&
    /[A-Z]{2}/u.test(literal)
  );
}

/**
 * blutter states a constant twice — once as the summarised operation, once on
 * the instruction that loads it — so the same threshold arrives back to back.
 */
function pushThreshold(events: CodeEvent[], value: number): void {
  const last = events.at(-1);
  if (last?.kind === "threshold" && last.value === value) {
    return;
  }
  events.push({ kind: "threshold", value });
}

function isInterestingLiteral(literal: string): boolean {
  return (
    literal.length > 0 &&
    literal.length <= 12 &&
    !literal.includes("=") &&
    !literal.includes(" ")
  );
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* walk(path);
    } else if (entry.endsWith(".dart")) {
      yield path;
    }
  }
}

/**
 * Library-level functions live in a synthetic class blutter prints as `::`, so
 * name them after the library instead: `jupiter_version_controller` is a more
 * useful identity in a report than `::`.
 */
function synthetic(path: string): string {
  return basename(path, ".dart");
}

export function methodKey(
  file: string,
  className: string,
  method: string,
): string {
  return `${file}#${className}::${method}`;
}

function analyze(
  file: string,
  className: string,
  method: string,
  body: string[],
): MethodFacts {
  const thresholds = new Set<number>();
  const intCompares = new Map<number, number>();
  const literals = new Set<string>();
  const calls = new Set<string>();
  const events: CodeEvent[] = [];

  for (const line of body) {
    // blutter resolves floating-point constants to a decimal value in its
    // annotation, which is where the firmware thresholds show up.
    // Only positive constants: a firmware version is never 0 or negative, and
    // those values show up all over as sentinels and initialisers.
    const dConst = /\bd\d+ = (-?\d+(?:\.\d+)?)/u.exec(line);
    if (dConst && Number(dConst[1]) > 0) {
      thresholds.add(Number(dConst[1]));
      pushThreshold(events, Number(dConst[1]));
    }
    const immDouble = /IMM: double\((-?\d+(?:\.\d+)?)\)/u.exec(line);
    if (immDouble && Number(immDouble[1]) > 0) {
      thresholds.add(Number(immDouble[1]));
      pushThreshold(events, Number(immDouble[1]));
    }
    const cmp = /\bcmp\s+[wx]?\d+, #(0x[0-9a-f]+|\d+)/u.exec(line);
    if (cmp) {
      const raw = cmp[1].startsWith("0x")
        ? parseInt(cmp[1], 16)
        : Number(cmp[1]);
      if (raw % 2 === 0 && raw > 0 && raw <= 512) {
        intCompares.set(raw, raw / 2);
      }
    }
    const literal = /\b[rx]\d+ = "([^"]*)"/u.exec(line);
    if (literal && isInterestingLiteral(literal[1])) {
      literals.add(literal[1]);
      if (isDeviceType(literal[1])) {
        events.push({ kind: "type", value: literal[1] });
      }
    }
    const call = /;\s*\[([^\]]+)\]\s*([\w$]+)::([\w$]+)/u.exec(line);
    if (call?.[1].startsWith(APP_PACKAGE_PREFIX)) {
      const target = call[1].slice(APP_PACKAGE_PREFIX.length);
      const targetClass = call[2] === "::" ? synthetic(target) : call[2];
      calls.add(methodKey(target, targetClass, call[3]));
    }
  }

  return {
    file,
    className,
    method,
    thresholds: [...thresholds].toSorted((a, b) => a - b),
    intCompares: [...intCompares.entries()]
      .toSorted((a, b) => a[0] - b[0])
      .map(([raw, untagged]) => ({ raw, untagged })),
    literals: [...literals].toSorted(),
    calls: [...calls].toSorted(),
    events,
  };
}

/**
 * Reads the events in code order into rules. A decision function tests a device
 * type and then loads the threshold that type is routed on, so the types seen
 * since the previous threshold are the ones that threshold applies to — and
 * several types can share one, the way HMM and HMN do.
 *
 * The order comes from the compiled code, not from a model of it, so a rule
 * says which numbers belong to which types, not which way the comparison goes.
 * Read the direction off the family's existing entry in the matrix.
 */
export function deriveRules(events: CodeEvent[]): RoutingRule[] {
  const rules = new Map<string, RoutingRule>();
  let pending: string[] = [];
  for (const event of events) {
    if (event.kind === "type") {
      pending.push(event.value);
      continue;
    }
    const types = [...new Set(pending)].toSorted();
    // A family checks the same firmware line repeatedly across its branches;
    // the first statement of a rule is the one worth keeping.
    const key = `${types.join(",")}:${event.value}`;
    if (!rules.has(key)) {
      rules.set(key, { types, threshold: event.value });
    }
    pending = [];
  }
  return [...rules.values()];
}

/**
 * blutter writes one file per Dart library: classes at the top level, methods
 * indented by two spaces, and the disassembly as comments inside each method.
 * That regular shape is enough to slice out method bodies without a real parser.
 */
function parseFile(path: string, appRoot: string): MethodFacts[] {
  const file = relative(appRoot, path);
  const lines = readFileSync(path, "utf8").split("\n");
  const methods: MethodFacts[] = [];
  let className = "";
  let current: { method: string; body: string[] } | null = null;

  for (const line of lines) {
    const classMatch = /^class (\S+)/u.exec(line);
    if (classMatch) {
      className = classMatch[1] === "::" ? synthetic(path) : classMatch[1];
      continue;
    }
    // Methods appear as `  static bool name() {`, `  _ name(...) {` and
    // `  get _ name(...) {`, so skip any number of leading tokens.
    const methodMatch = /^ {2}(?:[\w?<>$]+ )*([\w$]+)\(.*\{$/u.exec(line);
    if (methodMatch) {
      current = { method: methodMatch[1], body: [] };
      continue;
    }
    if (line === "  }") {
      if (current) {
        methods.push(analyze(file, className, current.method, current.body));
      }
      current = null;
      continue;
    }
    current?.body.push(line);
  }
  return methods;
}

export interface AppIndex {
  /** By `<library>#<Class>::<method>`. */
  byKey: Map<string, MethodFacts>;
  /**
   * By `<library>#<method>`. Library-level functions are named after their file
   * here but referred to by their real class name at the call site, so the exact
   * key misses and this is what resolves the delegation.
   */
  byLibraryAndMethod: Map<string, MethodFacts>;
}

/** Every method in the app's own libraries, keyed for delegation lookups. */
export function indexApp(appRoot: string): AppIndex {
  const byKey = new Map<string, MethodFacts>();
  const byLibraryAndMethod = new Map<string, MethodFacts>();
  for (const path of walk(appRoot)) {
    for (const facts of parseFile(path, appRoot)) {
      byKey.set(methodKey(facts.file, facts.className, facts.method), facts);
      byLibraryAndMethod.set(`${facts.file}#${facts.method}`, facts);
    }
  }
  return { byKey, byLibraryAndMethod };
}

function lookup(index: AppIndex, key: string): MethodFacts | undefined {
  const exact = index.byKey.get(key);
  if (exact) {
    return exact;
  }
  const [file, symbol] = key.split("#");
  const method = symbol?.split("::")[1];
  return method ? index.byLibraryAndMethod.get(`${file}#${method}`) : undefined;
}

/**
 * Collects the routing decisions, folding each entry point together with what
 * it delegates to: a family's strategy class usually holds no numbers itself
 * and forwards straight to its version controller.
 */
export function findDecisionSites(appRoot: string): DecisionSite[] {
  const index = indexApp(appRoot);
  const sites: DecisionSite[] = [];

  for (const [key, facts] of index.byKey) {
    const axis = ENTRY_POINTS[facts.method];
    if (!axis || UNINTERESTING.test(facts.file)) {
      continue;
    }

    const thresholds = new Set(facts.thresholds);
    const intCompares = new Map(
      facts.intCompares.map((c) => [c.raw, c.untagged]),
    );
    const literals = new Set(facts.literals);
    const events = [...facts.events];
    const resolvedThrough: string[] = [];
    const seen = new Set([key]);

    let frontier = facts.calls;
    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      const next: string[] = [];
      for (const callee of frontier) {
        if (seen.has(callee) || UNINTERESTING.test(callee)) {
          continue;
        }
        seen.add(callee);
        const target = lookup(index, callee);
        if (!target) {
          continue;
        }
        resolvedThrough.push(callee);
        target.thresholds.forEach((t) => thresholds.add(t));
        target.intCompares.forEach((c) => intCompares.set(c.raw, c.untagged));
        target.literals.forEach((l) => literals.add(l));
        events.push(...target.events);
        next.push(...target.calls);
      }
      frontier = next;
    }

    sites.push({
      ...facts,
      axis,
      thresholds: [...thresholds].toSorted((a, b) => a - b),
      intCompares: [...intCompares.entries()]
        .toSorted((a, b) => a[0] - b[0])
        .map(([raw, untagged]) => ({ raw, untagged })),
      literals: [...literals].toSorted(),
      events,
      resolvedThrough,
      rules: deriveRules(events),
    });
  }

  return sites.toSorted((a, b) =>
    methodKey(a.file, a.className, a.method).localeCompare(
      methodKey(b.file, b.className, b.method),
    ),
  );
}
