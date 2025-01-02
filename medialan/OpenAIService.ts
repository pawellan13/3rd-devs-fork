import { createByModelName } from "@microsoft/tiktokenizer";
import { ElevenLabsClient } from "elevenlabs";
import fs from "fs/promises";
import Groq from "groq-sdk";
import OpenAI, { toFile } from "openai";
import type {
    ChatCompletion,
    ChatCompletionChunk,
    ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type { CreateEmbeddingResponse } from "openai/resources/embeddings";
import type { ImageProcessingResult } from "../context/OpenAIService";

export class OpenAIService {
    private openai: OpenAI;
    private tokenizers: Map<
        string,
        Awaited<ReturnType<typeof createByModelName>>
    > = new Map();
    private readonly IM_START = "<|im_start|>";
    private readonly IM_END = "<|im_end|>";
    private readonly IM_SEP = "<|im_sep|>";
    private elevenlabs: ElevenLabsClient;
    private groq: Groq;
    private readonly JINA_API_KEY = process.env.JINA_API_KEY;

    constructor() {
        this.openai = new OpenAI();
        this.elevenlabs = new ElevenLabsClient({
            apiKey: process.env.ELEVENLABS_API_KEY,
        });
        this.groq = new Groq({
            apiKey: process.env.GROQ_API_KEY,
        });
    }

    // Tokenizer for OpenAI GPT models
    private async getTokenizer(modelName: string) {
        if (!this.tokenizers.has(modelName)) {
            const specialTokens: ReadonlyMap<string, number> = new Map([
                [this.IM_START, 100264],
                [this.IM_END, 100265],
                [this.IM_SEP, 100266],
            ]);
            const tokenizer = await createByModelName(modelName, specialTokens);
            this.tokenizers.set(modelName, tokenizer);
        }
        return this.tokenizers.get(modelName)!;
    }

    // Count the number of tokens in a chat completion request
    async countTokens(
        messages: ChatCompletionMessageParam[],
        model: string = "gpt-4o"
    ): Promise<number> {
        const tokenizer = await this.getTokenizer(model);

        let formattedContent = "";
        messages.forEach((message) => {
            formattedContent += `${this.IM_START}${message.role}${this.IM_SEP}${
                message.content || ""
            }${this.IM_END}`;
        });
        formattedContent += `${this.IM_START}assistant${this.IM_SEP}`;

        const tokens = tokenizer.encode(formattedContent, [
            this.IM_START,
            this.IM_END,
            this.IM_SEP,
        ]);
        return tokens.length;
    }

    // Create an embedding for a given text
    async createEmbedding(text: string): Promise<number[]> {
        try {
            const response: CreateEmbeddingResponse =
                await this.openai.embeddings.create({
                    model: "text-embedding-3-large",
                    input: text,
                });
            return response.data[0].embedding;
        } catch (error) {
            console.error("Error creating embedding:", error);
            throw error;
        }
    }

    // Create an embedding using the Jina API
    async createJinaEmbedding(text: string): Promise<number[]> {
        try {
            const response = await fetch("https://api.jina.ai/v1/embeddings", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.JINA_API_KEY}`,
                },
                body: JSON.stringify({
                    model: "jina-embeddings-v3",
                    task: "text-matching",
                    dimensions: 1024,
                    late_chunking: false,
                    embedding_type: "float",
                    input: [text],
                }),
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            return data.data[0].embedding;
        } catch (error) {
            console.error("Error creating Jina embedding:", error);
            throw error;
        }
    }

    // Perform a chat completion
    async completion(config: {
        messages: ChatCompletionMessageParam[];
        model?: string;
        stream?: boolean;
        jsonMode?: boolean;
        maxTokens?: number;
    }): Promise<
        | OpenAI.Chat.Completions.ChatCompletion
        | AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
    > {
        const {
            messages,
            model = "gpt-4o",
            stream = false,
            jsonMode = false,
            maxTokens = 4096,
        } = config;
        try {
            const chatCompletion = await this.openai.chat.completions.create({
                messages,
                model,
                ...(model !== "o1-mini" &&
                    model !== "o1-preview" && {
                        stream,
                        max_tokens: maxTokens,
                        response_format: jsonMode
                            ? { type: "json_object" }
                            : { type: "text" },
                    }),
            });

            return stream
                ? (chatCompletion as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>)
                : (chatCompletion as OpenAI.Chat.Completions.ChatCompletion);
        } catch (error) {
            console.error("Error in OpenAI completion:", error);
            throw error;
        }
    }

    // Calculate the token cost of processing an image
    async calculateImageTokens(
        width: number,
        height: number,
        detail: "low" | "high"
    ): Promise<number> {
        let tokenCost = 0;

        if (detail === "low") {
            tokenCost += 85;
            return tokenCost;
        }

        const MAX_DIMENSION = 2048;
        const SCALE_SIZE = 768;

        // Resize to fit within MAX_DIMENSION x MAX_DIMENSION
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
            const aspectRatio = width / height;
            if (aspectRatio > 1) {
                width = MAX_DIMENSION;
                height = Math.round(MAX_DIMENSION / aspectRatio);
            } else {
                height = MAX_DIMENSION;
                width = Math.round(MAX_DIMENSION * aspectRatio);
            }
        }

        // Scale the shortest side to SCALE_SIZE
        if (width >= height && height > SCALE_SIZE) {
            width = Math.round((SCALE_SIZE / height) * width);
            height = SCALE_SIZE;
        } else if (height > width && width > SCALE_SIZE) {
            height = Math.round((SCALE_SIZE / width) * height);
            width = SCALE_SIZE;
        }

        // Calculate the number of 512px squares
        const numSquares = Math.ceil(width / 512) * Math.ceil(height / 512);

        // Calculate the token cost
        tokenCost += numSquares * 170 + 85;

        return tokenCost;
    }

    // function to process single image
    async processImage(imagePath: string): Promise<ImageProcessingResult> {
        try {
            const image = await fs.readFile(imagePath);
            const base64Image = image.toString("base64");

            const response = await this.openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: "Describe this image in detail.",
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:image/jpeg;base64,${base64Image}`,
                                },
                            },
                        ],
                    },
                ],
            });

            return {
                description:
                    response.choices[0].message.content ||
                    "No description available.",
                source: imagePath,
            };
        } catch (error) {
            console.error(`Error processing image ${imagePath}:`, error);
            throw error;
        }
    }
    // function to process multiple images
    async processImages(
        imagePaths: string[]
    ): Promise<ImageProcessingResult[]> {
        try {
            const results = await Promise.all(
                imagePaths.map((path) => this.processImage(path))
            );
            return results;
        } catch (error) {
            console.error("Error processing multiple images:", error);
            throw error;
        }
    }

    // function to check if response is a stream
    isStreamResponse(
        response: ChatCompletion | AsyncIterable<ChatCompletionChunk>
    ): response is AsyncIterable<ChatCompletionChunk> {
        return Symbol.asyncIterator in response;
    }

    // function to parse JSON response
    parseJsonResponse<IResponseFormat>(
        response: ChatCompletion
    ): IResponseFormat | { error: string; result: boolean } {
        try {
            const content = response.choices?.[0]?.message?.content;
            if (!content) {
                throw new Error("Invalid response structure");
            }
            const parsedContent = JSON.parse(content);
            return parsedContent;
        } catch (error) {
            console.error("Error parsing JSON response:", error);
            return { error: "Failed to process response", result: false };
        }
    }

    // function to create a chat completion message
    async speak(text: string) {
        const response = await this.openai.audio.speech.create({
            model: "tts-1",
            voice: "alloy",
            input: text,
        });

        console.log("Response:", response.body);
        const stream = response.body;
        return stream;
    }

    // function to transcribe audio
    async transcribe(audioBuffer: Buffer): Promise<string> {
        console.log("Transcribing audio...");

        const transcription = await this.openai.audio.transcriptions.create({
            file: await toFile(audioBuffer, "speech.mp3"),
            language: "pl",
            model: "whisper-1",
        });
        return transcription.text;
    }

    // function to transcribe audio using Groq
    async transcribeGroq(audioBuffer: Buffer): Promise<string> {
        const transcription = await this.groq.audio.transcriptions.create({
            file: await toFile(audioBuffer, "speech.mp3"),
            language: "pl",
            model: "whisper-large-v3",
        });
        return transcription.text;
    }

    // function to speak using ElevenLabs
    async speakEleven(
        text: string,
        voice: string = "21m00Tcm4TlvDq8ikWAM",
        modelId: string = "eleven_turbo_v2_5"
    ) {
        try {
            const audioStream = await this.elevenlabs.generate({
                voice,
                text,
                model_id: modelId,
                stream: true,
            });

            return audioStream;
        } catch (error) {
            console.error("Error in ElevenLabs speech generation:", error);
            throw error;
        }
    }

    // function keyword extraction
    async extractKeywords(content: string, facts: string[]): Promise<string[]> {
        console.log("Extracting keywords...");
        const factsContext =
            facts.length > 0
                ? "\n\nAdditional context from facts:\n" + facts.join("\n")
                : "";

        const messages: ChatCompletionMessageParam[] = [
            {
                role: "system",
                content:
                    "You are a keyword extraction specialist. Extract key terms in their base form (nominative case for nouns). Return a comma-separated list of keywords. Maximum 10 keywords.",
            },
            {
                role: "user",
                content: `Extract important keywords from the following text. Return them as a comma-separated list in their base form. Focus on subjects, important terms, and names.

Text:
${content}${factsContext}`,
            },
        ];

        const response = (await this.completion({
            messages,
            model: "gpt-4o-mini",
        })) as OpenAI.Chat.Completions.ChatCompletion;

        const keywords =
            response.choices[0].message.content
                ?.split(",")
                .map((keyword) => keyword.trim())
                .filter((keyword) => keyword.length > 0) || [];

        return keywords;
    }
}
