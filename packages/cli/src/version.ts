import packageJson from "../package.json";

/** Version reported by `clango --version`, kept in sync with `package.json`. */
export const VERSION: string = packageJson.version;
