// The client source uses extensionless imports for the Paseo bundler. Node needs the
// ".ts" extension, so add it for relative imports from TypeScript files in tests.
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parentPath = context.parentURL ? new URL(context.parentURL).pathname : "";
    if (specifier.startsWith(".") && parentPath.endsWith(".ts") && !/\.\w+$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
