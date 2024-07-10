import { PrismaClient, Prisma } from "@prisma/client"
import { cowpatify } from "./cowpat"
import { Inngest } from "inngest"
import { OpenAI } from "openai"
import { DialogueEvaluatorConfig } from "./values-tools/dialogue-evaluator"
import { ArticulatorConfig } from "./values-tools/articulator-config"

import dftDefaultConfig from "./values-tools/articulator-configs/dft-default"
import dftGeneralConfig from "./values-tools/articulator-configs/dft-general"

export const db = new PrismaClient()

export const auth = cowpatify({
  site: "Democratic Fine-Tuning",
  users: db.user,
  inviteCode: db.inviteCode,
})

export const inngest = new Inngest({
  name: process.env.INNGEST_NAME ?? "Democratic Fine-Tuning",
  apiKey: process.env.INNGEST_API_KEY,
  eventKey: process.env.INNGEST_EVENT_KEY,
})

export const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  }
)

export const isChatGpt = process.env.VALUE_STYLE !== "personal"

export const dialogueEvaluatorConfig: DialogueEvaluatorConfig = {
  where: {
    evaluation: {
      equals: Prisma.DbNull,
    },
    user: {
      isAdmin: {
        not: {
          equals: true,
        },
      },
    },
    copiedFromId: {
      equals: null,
    },
  },
}

export const articulatorConfigs: { [key: string]: ArticulatorConfig } = {
  default: dftDefaultConfig,
  general: dftGeneralConfig,
}

export const chatModel:string = process.env.OPENAI_MODEL ?? "gpt-4o";
