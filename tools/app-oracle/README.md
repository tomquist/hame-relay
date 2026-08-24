# app-oracle

Reads the Marstek app's own routing rules — which cloud broker a device talks
to, and when its topic id is encrypted — straight out of the shipped app, and
compares them against [`src/device_matrix.ts`](../../src/device_matrix.ts).

Those rules are the reason a device does or does not exchange data. Until now
each new device family or firmware line meant a manual decompile session, and
several entries in the changelog carry the note "matches the official app's
behavior but is not yet confirmed against a live device". This turns that into a
command that prints a diff.

## No emulator, no device, no account

The app is a Flutter build: its logic is compiled into `libapp.so` as Dart AOT
code. That code can be _read_ on any machine; running it is the hard part, and
it turns out not to be necessary.

Three facts, measured against app 1.6.72:

- The app ships **arm64 only** — there is no x86_64 split to run natively on a
  normal CI box.
- Its snapshot is **Dart 3.8.1**, and its build configuration
  (`arm64 android compressed-pointers`) does not match any published standalone
  Dart runtime, which is built `linux no-compressed-pointers`. The stock
  `dartaotruntime` therefore refuses to load it — the snapshot _format_ matches,
  only the build configuration differs, so executing the app's own functions
  would mean building a Dart VM with that configuration and driving it under
  qemu-user. Possible, not needed for the routing table.
- The routing decisions are **plain firmware-version comparisons** against
  constants, which the disassembly states outright.

So this pipeline is: download the app, disassemble it with
[blutter](https://github.com/worawit/blutter), read the constants, diff. It runs
headless on an ordinary Linux box in a few minutes.

## Running it

```bash
npm run oracle -- doctor           # what this host is missing, if anything
npm run oracle -- all              # pull + extract + report + diff
```

Or step by step:

| Command   | What it does                                                                                                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `doctor`  | Checks build tooling, disk, and what is already cached                                                                                                                           |
| `pull`    | Downloads the app (via [apkeep](https://github.com/EFForg/apkeep)) and unpacks `libapp.so` + `libflutter.so`; `--version 1.6.72` pins a build, `--apk PATH` uses a local archive |
| `extract` | Runs blutter. The first run builds a Dart VM matching the app's Dart version (several minutes); later runs reuse it                                                              |
| `report`  | Reads the routing rules out of the disassembly into `results/app-<version>.json`                                                                                                 |
| `diff`    | Compares that report against `src/device_matrix.ts`; exits non-zero on drift                                                                                                     |

Prerequisites on Debian/Ubuntu (`doctor` prints this too):

```bash
apt-get install -y git curl unzip python3 python3-pip cmake ninja-build \
  build-essential pkg-config libicu-dev libcapstone-dev
pip install pyelftools requests
```

Or use the image, which carries the toolchain and nothing from the app:

```bash
docker build -t app-oracle tools/app-oracle
docker run --rm -v "$PWD:/repo" -v app-oracle-work:/work app-oracle all
```

Keep the `/work` volume: it holds the Dart VM build, which is the slow part.

## Reading the diff

`diff` prints three sections.

**Rules the app states per device type.** The headline: one row per matrix
profile and axis, with the numbers the profile declares next to the numbers the
app routes those types on.

```
  ! HMA                broker    matrix 226              app b2500 154, legacy-mqtt 154/226
    HME-3/HME-5        broker    matrix 33/116           app ct-hme 33/116, legacy-mqtt 33/116
    HMB                broker    matrix always hame-2024 app b2500 133, legacy-mqtt 133
```

The rules come from the order of the compiled code: a decision function tests a
device type and then loads the threshold that type is routed on, so the types
named since the previous threshold are the ones it applies to — which is how
`HMM` and `HMN` end up sharing 230 while `JPLS` takes 232. Types are matched to
profiles with `resolveProfile`, the same matcher the relay uses at run time, so
a rule about `HME-2` lands on the profile that would serve an HME-2 device.

`!` marks a profile whose declared number the app no longer states for those
types. Two things it deliberately does not mark, both worth reading anyway: a
row where the matrix says `always hame-2024` / `never` and the app states a
threshold (the matrix may be pinning a device on purpose — HMD is), and a
difference that appears only in the `legacy-mqtt` column, which is the app's
older routing path.

What a rule does **not** give you is the direction of the comparison. The code
order says `HMK` goes with 205; whether that is "2025 broker from 205 up" comes
from how the family's existing entry reads. Families are consistent about it,
but it is a read.

**Thresholds in the matrix the app no longer has where expected**, including the
`remote-topic-id` versions — the app has no separate decision for those, so they
are checked against its broker constants, which is where it makes that switch.

**Thresholds the app has that the matrix does not model.** Some are deliberate:
the HMD 154 migration was removed on purpose (#214) because following it broke
those devices.

Three things keep this advisory rather than authoritative:

1. **The app carries more than one routing path.** In 1.6.72 the older MQTT code
   still holds the `226` rule this project models for HMA/HMF/HMK, while a newer
   per-device strategy holds different numbers for the same types. Which one
   governs a real connection is a question for a device, not for this tool.
2. **Some splits are not made on a type literal.** The app separates HMI-2000
   from other HMI inverters somewhere other than a string comparison in the
   decision function, so the HMI rows show the family's numbers without
   attributing them per model.
3. **Some decisions are dynamically dispatched.** Venus reaches its per-model
   strategy through an interface, and HMG's broker choice goes the same way. No
   static reader can follow that, so those rules are missing from the report
   rather than absent from the app.

The matrix stays the source of truth. This tool tells you what the app says.

## What is committed

Only `results/app-<version>.json`: firmware numbers and device types under this
project's own family names. The files are deterministic — the same app build
produces the same bytes — so `git diff` between two versions shows exactly what
Marstek changed.

Everything else — the app archive, the extracted libraries, blutter's
disassembly, the per-method detail in `work/asm-out/decision-sites.json` — stays
in `work/`, which is gitignored. Do not commit it, attach it to an issue, or
paste it into a PR: it is a view of Marstek's binary, and only the protocol
facts derived from it are ours to publish. See the interoperability statement in
the [README](../../README.md#interoperability-statement).
