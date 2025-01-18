import { readdir, readFile } from "fs/promises";
import { join } from "path";

export class FileService {
    constructor(private basePath: string) {}

    async readAllFiles(directory: string): Promise<Map<string, string>> {
        const files = new Map<string, string>();
        const dirPath = join(this.basePath, directory);
        const fileList = await readdir(dirPath);

        for (const file of fileList) {
            if (file.endsWith(".txt")) {
                const content = await readFile(join(dirPath, file), "utf-8");
                files.set(file, content);
            }
        }
        return files;
    }

    async readFacts(): Promise<string[]> {
        const factsPath = join(this.basePath, "facts");
        const facts: string[] = [];

        try {
            const factFiles = await readdir(factsPath);
            for (const file of factFiles) {
                if (file.endsWith(".txt")) {
                    const content = await readFile(
                        join(factsPath, file),
                        "utf-8"
                    );
                    facts.push(content);
                }
            }
        } catch (error) {
            console.warn(
                "Facts directory not found or error reading facts:",
                error
            );
        }

        return facts;
    }

    async readWeaponTests(): Promise<
        Array<{ date: string; content: string; filename: string }>
    > {
        const weaponsPath = join(this.basePath, "weapons_test");
        const results: Array<{
            date: string;
            content: string;
            filename: string;
        }> = [];

        try {
            const files = await readdir(weaponsPath);
            for (const file of files) {
                if (file.endsWith(".txt")) {
                    const dateStr = file.replace(".txt", "");
                    const [year, month, day] = dateStr.split("_").map(Number);
                    const date = new Date(year, month - 1, day + 1); // Adjust date by adding 1 day
                    const formattedDate = date.toISOString().split("T")[0]; // Format date as YYYY-MM-DD

                    const content = await readFile(
                        join(weaponsPath, file),
                        "utf-8"
                    );
                    results.push({
                        date: formattedDate,
                        content,
                        filename: file,
                    });
                }
            }
        } catch (error) {
            console.warn(
                "Weapons test directory not found or error reading files:",
                error
            );
        }

        return results.sort(
            (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        );
    }

    async readFileContent(filePath: string): Promise<string> {
        try {
            const fullPath = join(this.basePath, filePath);
            const content = await readFile(fullPath, "utf-8");
            return content;
        } catch (error) {
            console.error(`Error reading file ${filePath}:`, error);
            throw error;
        }
    }
}
