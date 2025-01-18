import console from "console";
import { promises as fs } from "fs";
import type { ChatCompletion } from "openai/resources/index.mjs";
import path from "path";
import { ApiService } from "./APIService";
import { FileService } from "./FileService";
import { OpenAIService } from "./OpenAIService";
import { TextSplitter, type IDoc } from "./TextService";

const openAIService = new OpenAIService();
const textSplitter = new TextSplitter();
const fileService = new FileService(__dirname);
const apiService = new ApiService();

async function initializeData() {
    console.log("⚙️  Initializing data...");
    const fileContent = await fileService.readFileContent("public/barbara.txt");
    const doc = await textSplitter.document(fileContent, "gpt-4o-mini");
    return doc;
}

async function determinePeopleAndPlace(
    query: IDoc
): Promise<{ people: string[]; place: string[] }> {
    const completion = (await openAIService.completion({
        messages: [
            {
                role: "system",
                content: `You are a helpful assistant that extracts people and places from a given text.
                  Return the result as a JSON object with two properties: "people" and "place".

                  Rules:
                  - Return names in the nominative case, capitalized, and without duplicates.
                  - Remove surnames and Polish characters.
                  - Ensure the JSON format is correct.
                  - Example output: { "people": ["RAFAŁ"], "place": ["WARSAW"] }`,
            },
            { role: "user", content: query.text },
        ],
    })) as ChatCompletion;

    let content = completion.choices[0].message.content?.trim();
    if (!content) {
        throw new Error("Completion content is null");
    }
    if (!content) {
        throw new Error("Completion content is null");
    }
    // Remove backticks and any surrounding code block markers
    content = content.replace(/```json|```/g, "").trim();
    return JSON.parse(content);
}

async function saveResultsToFile(peopleAndPlace: {
    people: string[];
    place: string[];
}) {
    const storagePath = path.join(__dirname, "storage");
    await fs.mkdir(storagePath, { recursive: true });

    await fs.writeFile(
        path.join(storagePath, "people.json"),
        JSON.stringify({ people: peopleAndPlace.people }, null, 2)
    );

    await fs.writeFile(
        path.join(storagePath, "place.json"),
        JSON.stringify({ place: peopleAndPlace.place }, null, 2)
    );

    console.log("🗄️  Data saved to storage/people.json and storage/place.json");
}

async function reportCity(city: string) {
    try {
        await apiService.fetchDataPlaces(city);
        console.log(`🚩 City reported to central: ${city}`);
    } catch (error) {
        console.error("❌ Error reporting city to central:", error);
    }
}

async function main() {
    console.log("⚙️  Main process started...");

    try {
        const initialData = await initializeData();
        const peopleAndPlace = await determinePeopleAndPlace(initialData);

        console.log(peopleAndPlace);

        await saveResultsToFile(peopleAndPlace);

        let peopleToCheck = [...peopleAndPlace.people];
        let placesToCheck = [...peopleAndPlace.place];
        let foundBarbara = false;

        while (
            !foundBarbara &&
            (peopleToCheck.length > 0 || placesToCheck.length > 0)
        ) {
            if (peopleToCheck.length > 0) {
                const person = peopleToCheck.shift();
                const newPeople = await apiService.fetchDataPeople(person);
                if (Array.isArray(newPeople) && newPeople.includes("BARBARA")) {
                    foundBarbara = true;
                    break;
                }
                if (Array.isArray(newPeople)) {
                    peopleToCheck.push(
                        ...newPeople.filter(
                            (p) =>
                                !peopleAndPlace.people.includes(p) &&
                                !peopleToCheck.includes(p)
                        )
                    );
                }
            }

            if (placesToCheck.length > 0) {
                const place = placesToCheck.shift();
                const newPlaces = await apiService.fetchDataPlaces(place);
                if (Array.isArray(newPlaces) && newPlaces.includes("BARBARA")) {
                    foundBarbara = true;
                    await reportCity(place);
                    break;
                }
                if (Array.isArray(newPlaces)) {
                    placesToCheck.push(
                        ...newPlaces.filter(
                            (p) =>
                                !peopleAndPlace.place.includes(p) &&
                                !placesToCheck.includes(p)
                        )
                    );
                }
            }
        }

        if (!foundBarbara) {
            console.log("❌ BARBARA not found in any city.");
        }
    } catch (error) {
        console.error("Error in main process:", error);
    }
}

main().catch(console.error);
