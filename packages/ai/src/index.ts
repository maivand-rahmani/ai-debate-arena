export { buildAiModel } from "./build-ai-model";
export type { BuildAiModelOptions, ResolvedProviderConfig } from "./build-ai-model";
export {
  ARENA_USER_AGENT,
  ARENA_VERSION,
  OPENCODE_SESSION_HEADER,
  isOpencodeGateway,
  opencodeGatewayHeaders,
} from "./opencode-gateway";
export { toSafeErrorMessage, toSafeProviderError, toSafeProviderErrorCode, sanitizeErrorText } from "./errors";
export type { SafeProviderError, SafeProviderErrorCode } from "./errors";
