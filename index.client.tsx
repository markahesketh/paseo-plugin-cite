import type { PluginClientContext } from "@getpaseo/plugin/client";
import { copyText } from "@getpaseo/plugin/client/react-native";

import { startCitationOverlay } from "./client/web/overlay";

export default function contribute(_client: PluginClientContext) {
  return startCitationOverlay({ copyFallback: copyText });
}
