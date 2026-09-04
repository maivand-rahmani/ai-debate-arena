import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { addProvider } from "../src/shared/config/provider-store";

const readline = createInterface({ input, output });
async function prompt(label: string, defaultValue?: string): Promise<string> {
  const answer = (await readline.question(`${label}${defaultValue ? ` [${defaultValue}]` : ""}: `)).trim();
  return answer || defaultValue || "";
}

try {
  const provider = await addProvider({
    id: await prompt("Provider id"),
    name: await prompt("Display name"),
    baseUrl: await prompt("Base URL", "https://api.openai.com/v1"),
    model: await prompt("Default model", "gpt-4o-mini"),
    apiKey: await prompt("API key"),
  });
  console.log(`Saved provider '${provider.id}' (${provider.name}) without displaying its API key.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unable to save provider");
  process.exitCode = 1;
} finally {
  readline.close();
}
