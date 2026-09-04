import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { addProvider } from "../src/shared/config/provider-db";

async function promptApi(prompt: (label: string, defaultValue?: string) => Promise<string>): Promise<"chat" | "responses"> {
  for (;;) {
    const answer = (await prompt("API type (chat/responses)", "chat")).toLowerCase();
    if (answer === "chat" || answer === "responses") return answer;
    console.log("API type must be 'chat' or 'responses'.");
  }
}

async function main(): Promise<void> {
  const readline = createInterface({ input, output });
  const prompt = async (label: string, defaultValue?: string): Promise<string> => {
    const answer = (await readline.question(`${label}${defaultValue ? ` [${defaultValue}]` : ""}: `)).trim();
    return answer || defaultValue || "";
  };

  try {
    const provider = await addProvider({
      id: await prompt("Provider id"),
      name: await prompt("Display name"),
      baseUrl: await prompt("Base URL", "https://api.openai.com/v1"),
      api: await promptApi(prompt),
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
}

main();
