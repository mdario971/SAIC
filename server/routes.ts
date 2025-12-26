import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { generateStrudelCode } from "./openai";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";

const generateRequestSchema = z.object({
  prompt: z.string().min(1).max(500),
  context: z.object({
    genre: z.string().optional(),
    bpm: z.number().optional(),
    key: z.string().optional(),
    includeDrums: z.boolean().optional(),
    includeBass: z.boolean().optional(),
    includeSynth: z.boolean().optional(),
  }).optional(),
});

const claudeRequestSchema = z.object({
  prompt: z.string().min(1).max(2000),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
  })).optional(),
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // AI Code Generation endpoint
  app.post("/api/generate", async (req, res) => {
    try {
      const { prompt, context } = generateRequestSchema.parse(req.body);
      
      const code = await generateStrudelCode(prompt, context);
      
      res.json({ code, success: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          error: "Invalid request. Prompt must be between 1-500 characters.",
          success: false 
        });
      }
      
      console.error("Generate error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to generate code",
        success: false 
      });
    }
  });

  // Claude AI Assistant endpoint for server management
  app.post("/api/claude", async (req, res) => {
    try {
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) {
        return res.status(503).json({ 
          error: "Claude AI is not configured. Please add ANTHROPIC_API_KEY to your environment.",
          success: false 
        });
      }

      const validatedData = claudeRequestSchema.parse(req.body);
      const { prompt, history } = validatedData;

      const anthropic = new Anthropic({ apiKey: anthropicKey });

      const systemPrompt = `You are a helpful server administration assistant. You help users manage their Linux server through natural language commands.

When users ask you to perform server tasks, you should:
1. Explain what you're going to do
2. Provide the exact shell command(s) needed
3. Wrap commands in a code block with \`\`\`bash

IMPORTANT SAFETY RULES:
- Never provide commands that could delete critical system files
- Always warn about potentially destructive operations
- Suggest safer alternatives when possible
- For package installations, prefer apt/dnf depending on the system

Common tasks you can help with:
- Checking system status (disk space, memory, CPU)
- Managing services (start, stop, restart)
- Viewing logs
- User management
- Package installation
- Network diagnostics`;

      const messages = history || [];
      messages.push({ role: "user", content: prompt });

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages.map((m: { role: string; content: string }) => ({
          role: m.role as "user" | "assistant",
          content: m.content
        })),
      });

      const assistantMessage = response.content[0].type === 'text' 
        ? response.content[0].text 
        : '';

      res.json({ 
        response: assistantMessage, 
        success: true 
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          error: "Invalid request format: " + error.errors.map(e => e.message).join(", "),
          success: false 
        });
      }
      console.error("Claude API error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to get AI response",
        success: false 
      });
    }
  });

  // Code snippets storage endpoints
  app.get("/api/snippets", async (req, res) => {
    try {
      const snippets = await storage.getSnippets();
      res.json({ snippets, success: true });
    } catch (error) {
      console.error("Get snippets error:", error);
      res.status(500).json({ error: "Failed to fetch snippets", success: false });
    }
  });

  app.post("/api/snippets", async (req, res) => {
    try {
      const { insertSnippetSchema } = await import("@shared/schema");
      const validatedData = insertSnippetSchema.parse(req.body);
      
      const snippet = await storage.createSnippet(validatedData);
      res.json({ snippet, success: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          error: "Invalid snippet data: " + error.errors.map(e => e.message).join(", "),
          success: false 
        });
      }
      console.error("Create snippet error:", error);
      res.status(500).json({ error: "Failed to save snippet", success: false });
    }
  });

  return httpServer;
}
