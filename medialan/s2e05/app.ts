import axios from "axios";
import express from "express";
import fs from "fs";
import { JSDOM } from "jsdom";
import path from "path";
import TurndownService from "turndown";
import { AssistantService } from "../AssistantService";
import { LangfuseService } from "../LangfuseService";
import { OpenAIService } from "../OpenAIService";
import { QAService } from "../QAService";

const app = express();
const port = 3000;
const baseUrl = "https://centrala.ag3nts.org/dane";

const langfuseService = new LangfuseService();
const openaiService = new OpenAIService();
const assistantService = new AssistantService(openaiService, langfuseService);
const qaService = new QAService(openaiService);

interface MediaTranscription {
    type: "audio" | "image";
    url: string;
    transcription: string;
}

const transcribeAudio = async (audioUrl: string): Promise<string> => {
    try {
        const audioResponse = await axios.get(audioUrl, {
            responseType: "arraybuffer",
        });
        // Using transcribeGroq instead of transcribeAudio
        const transcription = await openaiService.transcribeGroq(
            audioResponse.data
        );
        return transcription;
    } catch (error) {
        console.error(`Error transcribing audio ${audioUrl}:`, error);
        return "[Audio transcription failed]";
    }
};

const describeImage = async (imageUrl: string): Promise<string> => {
    try {
        // Download image to temporary file
        const imageResponse = await axios.get(imageUrl, {
            responseType: "arraybuffer",
        });
        const tempFilePath = path.join(
            __dirname,
            "memory",
            `temp_${Date.now()}.png`
        );
        await fs.promises.writeFile(tempFilePath, imageResponse.data);

        // Use processImage instead of describeImage
        const result = await openaiService.processImage(tempFilePath);

        // Clean up temp file
        await fs.promises.unlink(tempFilePath);

        return result.description;
    } catch (error) {
        console.error(`Error describing image ${imageUrl}:`, error);
        return "[Image description failed]";
    }
};

const getMediaUrl = (fileName: string): string => {
    // All media files are in the /i/ directory
    return `${baseUrl}/i/${fileName}`;
};

const processMediaElements = async (
    html: string
): Promise<MediaTranscription[]> => {
    const transcriptions: MediaTranscription[] = [];
    // Replace DOMParser with JSDOM
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const audioElements = doc.getElementsByTagName("audio");
    for (const audio of audioElements) {
        const sourceUrl = audio.getAttribute("src") || "";
        if (sourceUrl) {
            const fileName = sourceUrl.split("/").pop() || "";
            const fullUrl = getMediaUrl(fileName);
            const transcription = await transcribeAudio(fullUrl);
            transcriptions.push({ type: "audio", url: fullUrl, transcription });
        }

        // Also check for source elements inside audio
        const sources = audio.getElementsByTagName("source");
        for (const source of sources) {
            const sourceUrl = source.getAttribute("src") || "";
            if (sourceUrl) {
                const fileName = sourceUrl.split("/").pop() || "";
                const fullUrl = getMediaUrl(fileName);
                console.log(`Processing audio source: ${fullUrl}`); // Debug log
                const transcription = await transcribeAudio(fullUrl);
                transcriptions.push({
                    type: "audio",
                    url: fullUrl,
                    transcription,
                });
            }
        }
    }

    const imageElements = doc.getElementsByTagName("img");
    for (const img of imageElements) {
        const sourceUrl = img.getAttribute("src") || "";
        if (sourceUrl) {
            const fileName = sourceUrl.split("/").pop() || "";
            const fullUrl = getMediaUrl(fileName);
            const description = await describeImage(fullUrl);
            transcriptions.push({
                type: "image",
                url: fullUrl,
                transcription: description,
            });
        }
    }

    return transcriptions;
};

const fetchQuestionsFromAPI = async () => {
    try {
        const response = await axios.get(
            "https://centrala.ag3nts.org/data/af10d80c-2a01-49b8-9726-f3cc2373523e/arxiv.txt"
        );
        const questions = response.data;

        const memoryDir = path.join(__dirname, "memory");
        const questionsPath = path.join(memoryDir, "questions.txt");
        fs.writeFileSync(questionsPath, questions);
        console.log(`Questions saved to ${questionsPath}`);
        return questions;
    } catch (error) {
        console.error("Error fetching questions:", error);
        return null;
    }
};

const convertToMarkdown = async (
    bodyContent: string,
    mediaTranscriptions?: MediaTranscription[]
) => {
    const turndownService = new TurndownService({
        headingStyle: "atx",
        hr: "---",
        bulletListMarker: "-",
        codeBlockStyle: "fenced",
    });

    if (mediaTranscriptions) {
        // Add rules with transcriptions
        turndownService.addRule("images", {
            filter: ["img"],
            replacement: function (content, node) {
                const img = node as HTMLImageElement;
                const alt = img.alt || "";
                const fileName =
                    (img.getAttribute("src") || "").split("/").pop() || "";
                const src = getMediaUrl(fileName);
                const title = img.title || "";
                const titlePart = title ? ` "${title}"` : "";

                const transcription = mediaTranscriptions.find(
                    (t) =>
                        t.type === "image" &&
                        (t.url === src || t.url.endsWith(src))
                );
                const description = transcription
                    ? `\n\n*Image Description: ${transcription.transcription}*`
                    : "";

                return `![${alt}](${src}${titlePart})${description}`;
            },
        });

        turndownService.addRule("audio", {
            filter: ["audio"],
            replacement: function (content, node) {
                const audio = node as HTMLAudioElement;
                let fileName = "";

                const src = audio.getAttribute("src");
                const sourceElement = node.querySelector("source");

                if (src) {
                    fileName = src.split("/").pop() || "";
                } else if (sourceElement) {
                    fileName =
                        (sourceElement.getAttribute("src") || "")
                            .split("/")
                            .pop() || "";
                }

                const fullUrl = getMediaUrl(fileName);
                const transcription = mediaTranscriptions.find(
                    (t) =>
                        t.type === "audio" &&
                        (t.url === fullUrl || t.url.endsWith(fullUrl))
                );
                const transcript = transcription
                    ? `\n\n*Audio Transcription: ${transcription.transcription}*`
                    : "";

                return `[🔊 Audio](${fullUrl})${transcript}`;
            },
        });
    } else {
        // Add rules without transcriptions
        turndownService.addRule("images", {
            filter: ["img"],
            replacement: function (content, node) {
                const img = node as HTMLImageElement;
                const alt = img.alt || "";
                const fileName =
                    (img.getAttribute("src") || "").split("/").pop() || "";
                const src = getMediaUrl(fileName);
                const title = img.title || "";
                const titlePart = title ? ` "${title}"` : "";

                return `![${alt}](${src}${titlePart})`;
            },
        });

        turndownService.addRule("audio", {
            filter: ["audio"],
            replacement: function (content, node) {
                const audio = node as HTMLAudioElement;
                let fileName = "";

                const src = audio.getAttribute("src");
                const sourceElement = node.querySelector("source");

                if (src) {
                    fileName = src.split("/").pop() || "";
                } else if (sourceElement) {
                    fileName =
                        (sourceElement.getAttribute("src") || "")
                            .split("/")
                            .pop() || "";
                }

                const fullUrl = getMediaUrl(fileName);

                return `[🔊 Audio](${fullUrl})`;
            },
        });
    }

    return turndownService.turndown(bodyContent);
};

const fetchAndSaveContent = async () => {
    console.log("Fetching and converting content...");
    try {
        const memoryDir = path.join(__dirname, "memory");
        if (!fs.existsSync(memoryDir)) {
            fs.mkdirSync(memoryDir);
        }

        const articleResponse = await axios.get(`${baseUrl}/arxiv-draft.html`);

        const questions = await fetchQuestionsFromAPI();
        const bodyContent = articleResponse.data.replace(
            /<head[\s\S]*?<\/head>/i,
            ""
        );

        // Create original version (without transcriptions)
        const originalMarkdown = await convertToMarkdown(bodyContent);
        const originalFilePath = path.join(
            memoryDir,
            "arxiv-draft-original.md"
        );

        // Create transcribed version
        const mediaTranscriptions = await processMediaElements(bodyContent);
        const transcribedMarkdown = await convertToMarkdown(
            bodyContent,
            mediaTranscriptions
        );
        const transcribedFilePath = path.join(
            memoryDir,
            "arxiv-draft-transcribed.md"
        );

        // Save both versions with questions if available
        if (questions) {
            fs.writeFileSync(
                originalFilePath,
                `${originalMarkdown}\n\n## Questions\n\n${questions}`
            );
            fs.writeFileSync(
                transcribedFilePath,
                `${transcribedMarkdown}\n\n## Questions\n\n${questions}`
            );
        } else {
            fs.writeFileSync(originalFilePath, originalMarkdown);
            fs.writeFileSync(transcribedFilePath, transcribedMarkdown);
        }

        console.log(`Original content saved to ${originalFilePath}`);
        console.log(`Transcribed content saved to ${transcribedFilePath}`);
    } catch (error) {
        console.error("Error fetching or converting content:", error);
    }
};

app.listen(port, async () => {
    console.log(`Server running at http://localhost:${port}`);
    // await fetchAndSaveContent();
    console.log("Processing questions...");
    await qaService.processQuestions();
    console.log("Questions processed and answers saved to answer.json");
});
