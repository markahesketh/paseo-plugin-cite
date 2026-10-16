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
