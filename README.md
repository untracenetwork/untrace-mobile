# Untrace Mobile

The Untrace app for iOS and Android, built with Expo.

This repo is a **thin client**. It holds no encryption, splitting or rebuild
code. All of that lives in the Untrace core, which ships as a compiled, signed
binary and is licensed separately.

## How the core gets in

1. `core.lock` pins the core version and the SHA-256 of each binary.
2. `npm run fetch-core` downloads the binaries, checks each digest against
   `core.lock`, and checks the minisign signature (key `86DD345E80D572CF`).
   Anything that does not match is refused.
3. `src/core/` is the only place the app talks to the core.

## Run

```bash
npm install
npx expo start
```

## Status

Starter app. The core binary is not linked yet: the core calls refuse to run
instead of falling back to anything else.

## Licence

Apache-2.0 for this repo. The Untrace core binary is licensed separately.

This repo is published from Untrace's private source as one commit per release.
Open an issue for bugs or ideas.
