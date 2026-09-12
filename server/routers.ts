import { z } from "zod";
import { invokeLLM } from "./_core/llm";
import { storagePut } from "./storage";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import {
  addProjectUpdate,
  claimChallenge,
  getChallenge,
  insertChallenge,
  insertChallengeMedia,
  insertEvent,
  listChallenges,
  listEvents,
  proposeSolution,
  sponsorEvent,
} from "./db";

const imageInput = z.object({
  name: z.string(),
  mimeType: z.string(),
  dataUrl: z.string().max(5_000_000),
});

export function triageChallengeFallback(name: string, description: string, requested: boolean) {
  return {
    urgency: requested ? "high" : "medium",
    category: /water|drain|road|bridge|street|waste/i.test(`${name} ${description}`) ? "Civic infrastructure" : "Community wellbeing",
    difficulty: /bridge|flood|treatment|network/i.test(`${name} ${description}`) ? "advanced" : "intermediate",
  } as const;
}

async function triageChallenge(name: string, description: string, requested: boolean) {
  const fallback = triageChallengeFallback(name, description, requested);
  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: "You are a careful civic innovation triage assistant. Return only the requested JSON. Treat a citizen's urgency checkbox as a signal, not proof. Never infer sensitive personal data." },
        { role: "user", content: `Classify this civic challenge. Name: ${name}. Description: ${description}. Citizen marked urgent: ${requested ? "yes" : "no"}.` },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "challenge_triage",
          strict: true,
          schema: {
            type: "object",
            properties: {
              urgency: { type: "string", enum: ["critical", "high", "medium", "low"] },
              category: { type: "string" },
              difficulty: { type: "string", enum: ["starter", "intermediate", "advanced"] },
            },
            required: ["urgency", "category", "difficulty"],
            additionalProperties: false,
          },
        },
      },
    });
    const content = response.choices?.[0]?.message?.content;
    const parsed = typeof content === "string" ? JSON.parse(content) : null;
    if (parsed?.urgency && parsed?.category && parsed?.difficulty) return parsed;
  } catch (error) {
    console.warn("[AI triage] fallback used", error);
  }
  return fallback;
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  challenges: router({
    list: publicProcedure.query(async () => listChallenges()),
    detail: publicProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => getChallenge(input.id)),
    create: publicProcedure.input(z.object({
      name: z.string().min(3),
      description: z.string().min(20),
      phone: z.string().min(8),
      aadhar: z.string().min(12).max(16),
      email: z.string().email().optional().or(z.literal("")),
      location: z.string().min(2),
      latitude: z.string().optional(),
      longitude: z.string().optional(),
      urgencyRequested: z.boolean(),
      images: z.array(imageInput).max(5),
    })).mutation(async ({ input }) => {
      const triage = await triageChallenge(input.name, input.description, input.urgencyRequested);
      const challengeId = await insertChallenge({
        name: input.name,
        description: input.description,
        phone: input.phone,
        aadharLast4: input.aadhar.slice(-4),
        email: input.email || null,
        location: input.location,
        latitude: input.latitude || null,
        longitude: input.longitude || null,
        urgencyRequested: input.urgencyRequested,
        aiUrgency: triage.urgency,
        category: triage.category,
        difficulty: triage.difficulty,
        status: "new",
      });
      if (challengeId && input.images.length) {
        const media = [];
        for (const image of input.images) {
          const [meta, base64] = image.dataUrl.split(",");
          const buffer = Buffer.from(base64 || meta, "base64");
          const stored = await storagePut(`challenges/${challengeId}/${Date.now()}-${image.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`, buffer, image.mimeType);
          media.push({ challengeId, url: stored.url, fileKey: stored.key, fileName: image.name, mimeType: image.mimeType });
        }
        await insertChallengeMedia(media);
      }
      return { id: challengeId, ...triage, reference: challengeId ? `CG-${String(challengeId).padStart(4, "0")}` : "CG-DEMO" };
    }),
    claim: publicProcedure.input(z.object({ id: z.number(), university: z.string().min(2) })).mutation(async ({ input }) => {
      await claimChallenge(input.id, input.university);
      return { success: true };
    }),
    update: publicProcedure.input(z.object({
      challengeId: z.number(),
      authorRole: z.string(),
      authorName: z.string(),
      body: z.string().min(5),
      status: z.string(),
    })).mutation(async ({ input }) => {
      const id = await addProjectUpdate(input);
      return { success: true, id };
    }),
    solution: publicProcedure.input(z.object({ id: z.number(), solution: z.string().min(20) })).mutation(async ({ input }) => {
      await proposeSolution(input.id, input.solution);
      return { success: true };
    }),
  }),
  events: router({
    list: publicProcedure.query(async () => listEvents()),
    create: publicProcedure.input(z.object({
      title: z.string().min(4),
      description: z.string().min(10),
      date: z.string().min(4),
      location: z.string().min(2),
      university: z.string().min(2),
      challengeId: z.number().optional(),
      sponsorshipTarget: z.number().min(0),
    })).mutation(async ({ input }) => {
      const id = await insertEvent({ ...input, challengeId: input.challengeId ?? null, sponsorRaised: 0 });
      return { success: true, id };
    }),
    sponsor: publicProcedure.input(z.object({
      eventId: z.number(),
      industryName: z.string().min(2),
      amount: z.number().min(0),
      contributionNote: z.string().optional(),
    })).mutation(async ({ input }) => {
      const id = await sponsorEvent(input);
      return { success: true, id };
    }),
  }),
});

export type AppRouter = typeof appRouter;
