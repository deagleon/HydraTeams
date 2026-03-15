import type { ServerResponse } from "node:http";
import { Readable } from "node:stream";

export interface GeminiResponseChunk {
    candidates?: Array<{
        content?: {
            role?: string;
            parts?: Array<{
                text?: string;
                functionCall?: {
                    name: string;
                    args: Record<string, unknown>;
                };
            }>;
        };
        finishReason?: string;
        index?: number;
    }>;
    usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
    };
}

export async function translateGeminiStream(
    geminiStream: ReadableStream<Uint8Array> | Readable,
    res: ServerResponse,
    spoofModel: string
): Promise<void> {
    const messageId = `msg_${Date.now()}`;
    let firstChunk = true;
    let blockIndex = 0;
    let textStarted = false;

    // Send message_start
    res.write(`event: message_start\ndata: ${JSON.stringify({
        type: "message_start",
        message: {
            id: messageId,
            type: "message",
            role: "assistant",
            model: spoofModel,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 }
        }
    })}\n\n`);

    const reader = geminiStream instanceof Readable
        ? geminiStream
        : Readable.from(streamToIterable(geminiStream));

    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    for await (const chunk of reader) {
        if (typeof chunk === 'string') {
            buffer += chunk;
        } else if (Buffer.isBuffer(chunk)) {
            buffer += chunk.toString('utf-8');
        } else if (chunk instanceof Uint8Array) {
            buffer += decoder.decode(chunk, { stream: true });
        } else {
            buffer += String(chunk);
        }

        // Gemini stream usually returns a JSON array or multiple JSON objects depending on how it's called.
        // If it's the REST streamGenerateContent, it might be a series of objects or a single JSON array if using ?alt=json.
        // We expect SSE format here if possible, but let's handle raw JSON chunks too.

        // Simple line-based or bracket-based parsing for now
        // Actually, fetch() with streamGenerateContent usually returns a stream of JSON objects if not SSE.
        // Let's assume we might get partial JSONs.

        let boundary;
        while ((boundary = buffer.indexOf("\n")) !== -1) {
            let line = buffer.slice(0, boundary).trim();
            buffer = buffer.slice(boundary + 1);

            if (line.startsWith("data: ")) line = line.slice(6);
            if (!line || line === "[" || line === "]") continue;
            if (line.endsWith(",")) line = line.slice(0, -1);

            try {
                let data = JSON.parse(line) as any;
                if (data.response) data = data.response; // Unwrap Antigravity format

                const candidate = data.candidates?.[0];

                if (candidate?.content?.parts) {
                    for (const part of candidate.content.parts) {
                        if (part.text) {
                            if (!textStarted) {
                                res.write(`event: content_block_start\ndata: ${JSON.stringify({
                                    type: "content_block_start",
                                    index: blockIndex,
                                    content_block: { type: "text", text: "" }
                                })}\n\n`);
                                textStarted = true;
                            }

                            res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                                type: "content_block_delta",
                                index: blockIndex,
                                delta: { type: "text_delta", text: part.text }
                            })}\n\n`);
                        }

                        if (part.functionCall) {
                            // Finish text if any
                            if (textStarted) {
                                res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: blockIndex })}\n\n`);
                                textStarted = false;
                                blockIndex++;
                            }

                            // Tool use start
                            res.write(`event: content_block_start\ndata: ${JSON.stringify({
                                type: "content_block_start",
                                index: blockIndex,
                                content_block: {
                                    type: "tool_use",
                                    id: `call_${Date.now()}_${blockIndex}`,
                                    name: part.functionCall.name,
                                    input: {}
                                }
                            })}\n\n`);

                            // Tool use delta (arguments as JSON string)
                            res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                                type: "content_block_delta",
                                index: blockIndex,
                                delta: { type: "input_json_delta", partial_json: JSON.stringify(part.functionCall.args) }
                            })}\n\n`);

                            // Tool use stop
                            res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: blockIndex })}\n\n`);
                            blockIndex++;
                        }
                    }
                }

                if (candidate?.finishReason) {
                    // Mapping finish reasons
                    const stopReason = candidate.finishReason === "STOP" ? "end_turn" :
                        candidate.finishReason === "MAX_TOKENS" ? "max_tokens" :
                            candidate.finishReason === "SAFETY" ? "end_turn" : "end_turn";

                    if (textStarted) {
                        res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: blockIndex })}\n\n`);
                        textStarted = false;
                    }

                    res.write(`event: message_delta\ndata: ${JSON.stringify({
                        type: "message_delta",
                        delta: { stop_reason: stopReason, stop_sequence: null },
                        usage: { output_tokens: data.usageMetadata?.candidatesTokenCount || 0 }
                    })}\n\n`);
                }
            } catch (e) {
                // Partial JSON or heartbeat
            }
        }
    }

    res.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
    res.end();
}

async function* streamToIterable(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) return;
            yield value;
        }
    } finally {
        reader.releaseLock();
    }
}
