import { join } from "path";
import { FileService } from "../FileService";
import { OpenAIService } from "../OpenAIService";
import { TextSplitter } from "../TextService";
import { VectorService } from "../VectorService";

const PUBLIC_DIR = join(__dirname, "public");
const COLLECTION_NAME = "raport-collection";
const queries = [
    "W raporcie, z którego dnia znajduje się wzmianka o kradzieży prototypu broni?",
];

const openai = new OpenAIService();
const vectorService = new VectorService(openai);
const textSplitter = new TextSplitter();
const fileService = new FileService(PUBLIC_DIR);

async function getWeaponTests() {
    console.log("🔍 Reading weapon tests...");
    const weaponTests = await fileService.readWeaponTests();
    return weaponTests;
}

async function initializeData() {
    console.log("⚙️  Initializing data...");
    const weaponTests = await getWeaponTests();
    console.log(weaponTests);
    const points = await Promise.all(
        weaponTests.map(async (test) => {
            const keywords = await openai.extractKeywords(test.content, []);
            const doc = await textSplitter.document(
                test.content,
                "gpt-4o-mini",
                {
                    date: `${test.date}`,
                    keyword: keywords,
                }
            );
            return doc;
        })
    );
    await vectorService.initializeCollectionWithData(COLLECTION_NAME, points);
}

async function main() {
    console.log("🚀 Starting main process...");
    // await initializeData();

    console.log("🔎 Performing search queries...");
    const searchResults = await Promise.all(
        queries.map((query) =>
            vectorService.performSearch(COLLECTION_NAME, query, undefined, 15)
        )
    );

    queries.forEach((query, index) => {
        console.log(`Query: ${query}`);
        const tableData = searchResults[index].map((result) => {
            const payload =
                (result.payload as { text?: string; date?: string }) || {};
            return {
                Text: payload.text
                    ? payload.text.substring(0, 20) +
                      (payload.text.length > 20 ? "..." : "")
                    : "No text available",
                Date: payload.date ?? "No date available",
                Score: result.score,
            };
        });
        console.table(tableData);
    });
}

main().catch(console.error);
