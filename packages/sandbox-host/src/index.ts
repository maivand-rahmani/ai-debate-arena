/**
 * @arena/sandbox-host — narrow local sandbox host for the debate-engine
 * sandbox-adapter contracts (F10-19/F10-24).
 *
 * Scope (deliberately narrow):
 * - ONE allow-listed, server-owned deterministic worker (SHA-256 over
 *   bounded input) executed inside a Windows Job Object.
 * - Fail-closed everywhere: without a behaviorally proven containment
 *   preflight the adapter reports `unavailable` and spawns nothing.
 * - NO generic command runner, NO source fetching, NO filesystem/network
 *   capabilities, NO client-controlled executables, args, env, or paths.
 *
 * See docs/security/sandbox-host.md for the threat model and the exact
 * supported-platform limitations.
 */
export * from "./win-job-ffi";
export * from "./worker-protocol";
export * from "./preflight";
export * from "./worker-host-adapter";
