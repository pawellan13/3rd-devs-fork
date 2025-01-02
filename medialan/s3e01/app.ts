import { writeFile } from "fs/promises";
import { join } from "path";
import { FileService } from "../FileService";
import { OpenAIService } from "../OpenAIService";

const PUBLIC_DIR = join(__dirname, "public");

async function main() {
    const fileService = new FileService(PUBLIC_DIR);
    const openaiService = new OpenAIService();
    const result: Record<string, string> = {};

    try {
        // Read all text files and facts
        const files = await fileService.readAllFiles("");
        const facts = await fileService.readFacts();

        // Process only the first 10 files
        let processed = 0;
        for (const [filename, content] of files) {
            if (processed >= 10) break;

            console.log(`Processing ${filename}...`);
            const keywords = await openaiService.extractKeywords(
                content,
                facts
            );
            result[filename] = keywords.join(", ");
            processed++;
        }

        // Save results
        await writeFile(
            join(PUBLIC_DIR, "answer.json"),
            JSON.stringify(result, null, 2),
            "utf-8"
        );

        console.log("Processing completed. Results saved in answer.json");
    } catch (error) {
        console.error("An error occurred:", error);
        process.exit(1);
    }
}

main();
