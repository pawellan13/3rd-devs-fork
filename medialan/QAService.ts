import fs from "fs/promises";
import path from "path";
import { OpenAIService } from "./OpenAIService";

interface Answers {
    [key: string]: string;
}

export class QAService {
    constructor(private openaiService: OpenAIService) {}

    async processQuestions(): Promise<void> {
        try {
            // Read article content
            const articlePath = path.join(
                __dirname,
                "memory",
                "arxiv-draft-transcribed.md"
            );
            const article = await fs.readFile(articlePath, "utf-8");

            // Read questions
            const questionsPath = path.join(
                __dirname,
                "memory",
                "questions.txt"
            );
            const questionsContent = await fs.readFile(questionsPath, "utf-8");

            // Parse questions into a map
            const questions = new Map<string, string>();
            questionsContent.split("\n").forEach((line) => {
                const match = line.match(/^(\d+)=(.+)$/);
                if (match) {
                    questions.set(match[1], match[2]);
                }
            });

            const answers: Answers = {};

            // Process each question
            for (const [id, question] of questions) {
                const response = await this.openaiService.completion({
                    messages: [
                        {
                            role: "system",
                            content:
                                "You are a helpful assistant that provides brief, one-sentence answers based on the provided article content. Answer directly without additional commentary.",
                        },
                        {
                            role: "user",
                            content: `Based on this article:\n\n${article}\n\nQuestion: ${question}\n\nProvide a brief, one-sentence answer.`,
                        },
                    ],
                    model: "gpt-4o",
                    temperature: 0,
                });

                if (!this.openaiService.isStreamResponse(response)) {
                    const answer =
                        response.choices[0].message.content?.trim() ||
                        "No answer available";
                    answers[id.padStart(2, "0")] = answer;
                }
            }

            // Save answers to answer.json
            const answersPath = path.join(__dirname, "memory", "answer.json");
            await fs.writeFile(answersPath, JSON.stringify(answers, null, 2));
        } catch (error) {
            console.error("Error processing questions:", error);
            throw error;
        }
    }
}
