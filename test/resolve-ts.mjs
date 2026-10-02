// The client source uses extensionless imports for the Paseo bundler. Node needs the
// ".ts" extension, so add it for relative imports from TypeScript files in tests.
// The Paseo app provides react-native at runtime, so tests use a small stub.
import { registerHooks } from "node:module";

const REACT_NATIVE_STUB = new URL("./react-native-stub.mjs", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react-native") return { url: REACT_NATIVE_STUB, shortCircuit: true };
    if (specifier.startsWith(".") && context.parentURL?.endsWith(".ts") && !/\.\w+$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
