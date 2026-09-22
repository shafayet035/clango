import { main } from "./main";

const code = await main(process.argv.slice(2), process.cwd(), {
  log: (message) => console.log(message),
  error: (message) => console.error(message),
});

process.exitCode = code;
