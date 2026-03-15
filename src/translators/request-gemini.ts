import type {
    AnthropicRequest,
    AnthropicMessage,
    AnthropicToolResultBlock,
    AnthropicToolUseBlock,
    AnthropicTextBlock,
} from "./types.js";

export interface GeminiRequest {
    contents: GeminiContent[];
    systemInstruction?: { parts: { text: string }[] };
    tools?: { functionDeclarations: GeminiFunctionDeclaration[] }[];
    generationConfig?: {
        maxOutputTokens?: number;
        temperature?: number;
        stopSequences?: string[];
    };
}

export interface GeminiContent {
    role: "user" | "model";
    parts: GeminiPart[];
}

export type GeminiPart =
    | { text: string }
    | { functionCall: { name: string; args: Record<string, unknown> }; thoughtSignature?: string; thought_signature?: string }
    | { functionResponse: { name: string; response: Record<string, unknown> } };

export interface GeminiFunctionDeclaration {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

export function translateRequestToGemini(
    anthropicReq: AnthropicRequest,
    targetModel: string
): GeminiRequest {
    const contents: GeminiContent[] = [];

    // Build a map of tool_use_id to tool_name from history
    const toolNameMap = new Map<string, string>();
    for (const msg of anthropicReq.messages) {
        if (Array.isArray(msg.content)) {
            for (const block of msg.content) {
                if (block.type === "tool_use") {
                    toolNameMap.set(block.id, block.name);
                }
            }
        }
    }

    for (const msg of anthropicReq.messages) {
        const role = msg.role === "assistant" ? "model" : "user";
        const parts: GeminiPart[] = [];

        if (typeof msg.content === "string") {
            parts.push({ text: msg.content });
        } else {
            for (const block of msg.content) {
                if (block.type === "text") {
                    parts.push({ text: block.text });
                } else if (block.type === "tool_use") {
                    parts.push({
                        functionCall: {
                            name: block.name,
                            args: block.input,
                        },
                        thoughtSignature: "skip_thought_signature_validator",
                        thought_signature: "skip_thought_signature_validator",
                    });
                } else if (block.type === "tool_result") {
                    const name = toolNameMap.get(block.tool_use_id) || "unknown_function";
                    let responseData: Record<string, unknown>;

                    if (typeof block.content === "string") {
                        responseData = { result: block.content };
                    } else {
                        responseData = { result: block.content };
                    }

                    parts.push({
                        functionResponse: {
                            name,
                            response: responseData,
                        },
                    });
                }
            }
        }

        if (parts.length > 0) {
            contents.push({ role, parts });
        }
    }

    const geminiReq: GeminiRequest = {
        contents,
        generationConfig: {
            maxOutputTokens: anthropicReq.max_tokens,
            temperature: anthropicReq.temperature,
        },
    };

    if (anthropicReq.system) {
        const systemText = typeof anthropicReq.system === "string"
            ? anthropicReq.system
            : anthropicReq.system.map(s => s.text).join("\n");
        geminiReq.systemInstruction = { parts: [{ text: systemText }] };
    }

    if (anthropicReq.tools) {
        geminiReq.tools = [{
            functionDeclarations: anthropicReq.tools.map(t => ({
                name: t.name,
                description: t.description || "",
                parameters: sanitizeSchema(t.input_schema),
            }))
        }];
    }

    return geminiReq;
}

/**
 * Strip fields that Vertex AI / Gemini API doesn't accept from JSON Schema.
 * Uses a WHITELIST approach — Vertex AI only accepts a very limited subset of JSON Schema.
 */
function sanitizeSchema(schema: unknown): Record<string, unknown> {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
        return schema as any;
    }

    const ALLOWED = new Set([
        "type", "properties", "required", "items", "enum",
        "description", "format", "nullable", "minimum", "maximum",
        "minItems", "maxItems", "pattern",
    ]);

    const inputSchema = schema as Record<string, unknown>;
    const cleaned: Record<string, unknown> = {};

    const propertyNames = new Set<string>();
    if (inputSchema.properties && typeof inputSchema.properties === "object") {
        for (const propName of Object.keys(inputSchema.properties as Record<string, unknown>)) {
            propertyNames.add(propName);
        }
    }

    for (const [key, value] of Object.entries(inputSchema)) {
        if (!ALLOWED.has(key)) continue;

        if (key === "type" && typeof value === "string") {
            cleaned[key] = value.toUpperCase();
        } else if (key === "properties" && typeof value === "object" && value !== null) {
            const props: Record<string, unknown> = {};
            for (const [propName, propVal] of Object.entries(value as Record<string, unknown>)) {
                if (typeof propVal === "object" && propVal !== null) {
                    props[propName] = sanitizeSchema(propVal);
                } else {
                    props[propName] = propVal;
                }
            }
            cleaned[key] = props;
        } else if (key === "items" && typeof value === "object" && value !== null) {
            cleaned[key] = sanitizeSchema(value);
        } else if (key === "required" && Array.isArray(value)) {
            if (propertyNames.size > 0) {
                const validRequired = value.filter(prop => typeof prop === "string" && propertyNames.has(prop));
                if (validRequired.length > 0) {
                    cleaned[key] = validRequired;
                }
            } else {
                cleaned[key] = value;
            }
        } else {
            cleaned[key] = value;
        }
    }

    if (cleaned.type === "ARRAY" && !cleaned.items) {
        cleaned.items = { type: "STRING" };
    }

    return cleaned;
}
