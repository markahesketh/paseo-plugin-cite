import type { PluginClientContext } from "@getpaseo/plugin/client";
import { copyText } from "@getpaseo/plugin/client/react-native";

import { startCitationOverlay } from "./client/web";

export default function contribute(_client: PluginClientContext) {
  return startCitationOverlay({
    async copyFallback(text) {
      await copyText(text);
    },
  });
}
