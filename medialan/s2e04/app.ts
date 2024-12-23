import type { ChatCompletionMessageParam } from "ai/prompts";
import express from "express";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { AssistantService } from "../AssistantService";
import { LangfuseService } from "../LangfuseService";
import { OpenAIService } from "../OpenAIService";

const app = express();
const port = 3000;

const langfuseService = new LangfuseService();
const openaiService = new OpenAIService();
const assistantService = new AssistantService(openaiService, langfuseService);

const processFiles = async () => {
    const extractPath = path.join(__dirname, "public");
    const transcriptionPath = path.join(__dirname, "transcriptions.json");

    const files = fs
        .readdirSync(extractPath)
        .filter((file) => !file.includes("facts"));

    let transcriptions = [];
    if (fs.existsSync(transcriptionPath)) {
        transcriptions = JSON.parse(
            fs.readFileSync(transcriptionPath, "utf-8")
        );
    }

    const processedFiles = new Set(
        transcriptions.map((t: { file: string }) => t.file)
    );

    for (const file of files) {
        if (processedFiles.has(file)) {
            continue;
        }

        const filePath = path.join(extractPath, file);
        const ext = path.extname(file).toLowerCase();

        let content = "";
        if (ext === ".txt") {
            content = fs.readFileSync(filePath, "utf-8");
        } else if (ext === ".mp3") {
            const audioBuffer = fs.readFileSync(filePath);
            content = await openaiService.transcribeGroq(audioBuffer);
        } else if (ext === ".png") {
            const imageProcessingResult = await openaiService.processImage(
                filePath
            );
            content = imageProcessingResult.description;
        }

        transcriptions.push({ file, content });
    }

    fs.writeFileSync(
        transcriptionPath,
        JSON.stringify(transcriptions, null, 2)
    );

    const peopleFiles = [];
    const hardwareFiles = [];

    for (const { file, content } of transcriptions) {
        const messages: ChatCompletionMessageParam[] = [
            {
                role: "user",
                content: content,
            },
        ];

        const systemMessage: ChatCompletionMessageParam = {
            role: "system",
            content: `Please extract only notes containing information about captured people or traces of their presence, as well as fixed hardware issues (omit those related to software and omit the facts directory) e.g.

PEOPLE: For notes describing people (captured or not but describing their hostile activity)
HARDWARE: For notes describing fixed hardware issues`,
        };

        const trace = langfuseService.createTrace({
            id: uuidv4(),
            name: content.slice(0, 45),
            sessionId: uuidv4(),
        });

        const answer = await assistantService.answer(
            { messages: [systemMessage, ...messages] },
            trace
        );

        const responseContent = answer.choices[0].message.content
            ? answer.choices[0].message.content.toLowerCase()
            : "";
        if (responseContent.includes("people")) {
            peopleFiles.push(file);
        } else if (responseContent.includes("hardware")) {
            hardwareFiles.push(file);
        }

        await langfuseService.finalizeTrace(
            trace,
            messages,
            answer.choices[0].message
        );
        // await LangfuseService.flushAsync();
    }

    const report = {
        people: peopleFiles.sort(),
        hardware: hardwareFiles.sort(),
    };

    fs.writeFileSync(
        path.join(__dirname, "result.json"),
        JSON.stringify(report, null, 2)
    );

    console.log(JSON.stringify(report, null, 2));
};

app.listen(port, async () => {
    console.log(`Server running at http://localhost:${port}`);
    await processFiles();
});
