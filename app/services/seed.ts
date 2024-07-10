import { FunctionDefinition } from "openai/resources"
import { db, inngest, openai, chatModel } from "~/config.server"
import { ValuesCardData } from "~/lib/consts"
import {
  cardCritiques,
  cardGuidelines,
} from "~/values-tools/articulator-configs/dft-general"

import {
  definitionOfASourceOfMeaning,
  exampleCards,
} from "~/values-tools/prompt-segments"

const generateContextsPrompt = `You will be given a set of values cards. Each card represents a source of meaning (see definition below).

Return a list of at least six conditions for when these values are relevant.

# Source of meaning definition

${definitionOfASourceOfMeaning}

# Guidelines

- Conditions are not about what someone needs, seeks, values, or wants. What the user is up to is irrelevant. Instead, conditions should be about the situation that someone is in when living by one of the values. For instance, a value about treating the user tenderly if they're having a rough time should have a condition like 'When someone is struggling', not 'When the user seeks support'.
- Conditions should be no more than 6 words.
- All should start 'When' or 'When someone'.
- Make them as broad as possible, while still coherent.

# Some example condition strings

When someone is struggling
When integrating into a new community
When welcoming someone into a new community
When considering the needs of others`

const generateContextsFunction: FunctionDefinition = {
  name: "generate_contexts",
  description:
    "Generate a list of at least 6 context strings, each depicting a scenario for when one of the values cards could be relevant.",
  parameters: {
    type: "object",
    properties: {
      contexts: {
        type: "array",
        items: {
          type: "string",
        },
        description:
          "A list of contexts for when some of the values cards could be relevant.",
      },
    },
    required: ["contexts"],
  },
}

async function generateContexts(
  valuesCards: ValuesCardData[]
): Promise<string[]> {
  const data = await openai.chat.completions.create({
    model: chatModel,
    messages: [
      { role: "system", content: generateContextsPrompt },
      { role: "user", content: JSON.stringify(valuesCards) },
    ],
    tool_choice: {type: 'function', function: { name: generateContextsFunction.name }},
    tools: [{type: 'function', function: generateContextsFunction}],
    temperature: 0.0,
  })
  const contexts = JSON.parse(data.choices[0].message.tool_calls![0].function.arguments)
    .contexts as string[]

  return contexts
}

const generateCardsFunction: FunctionDefinition = {
  name: "generate_values_cards",
  description:
    "Generate 6 values cards for the situation at hand, that all perfectly meet the criteria.",
  parameters: {
    type: "object",
    properties: {
      values_cards: {
        type: "array",
        items: {
          type: "object",
          properties: {
            evaluation_criteria: {
              type: "array",
              items: {
                type: "string",
              },
              description:
                "A list of things to attend to when following the source of meaning. They should be precise, but general, such that anyone could evaluate wether someone is attending to them or not.",
            },
            instructions_detailed: {
              type: "string",
              description:
                "A detailed instruction for how to follow this source of meaning.",
            },
            instructions_short: {
              type: "string",
              description:
                "A short instruction for how to follow this source of meaning.",
            },
            title: {
              type: "string",
              description: "The title of the values card.",
            },
          },
        },
      },
    },
    required: ["values_cards"],
  },
}

const generateCardPrompt = `You will be given a question. Based on this question, generate 6 different values cards depicting 6 different sources of meaning. The sources of meaning should be about values people have that are relevant for the question. For example, if the question is about how to deal with immigration issues in a country, the sources of meaning could be about how someone finds it meaningful to be welcomed into a new community, or how someone finds it meaningful to discuss good boundaries.

# Source of meaning definition

${definitionOfASourceOfMeaning}

# Values card guideines

${cardGuidelines}

# Values card examples

Here are some example of how values cards could look. You should follow this same format exactly:

${exampleCards}

# Card critiques

${cardCritiques}`

async function generateValuesCards(
  question: string
): Promise<ValuesCardData[]> {
  const data = await openai.chat.completions.create({
    model: chatModel,
    messages: [
      { role: "system", content: generateCardPrompt },
      { role: "user", content: question },
    ],
    tool_choice: { type: 'function', function: { name: generateCardsFunction.name }},
    tools: [{type: 'function', function: generateCardsFunction}],
    temperature: 0.2,
  })
  const valuesCards = JSON.parse(
    data.choices[0].message.tool_calls![0].function.arguments
  ).values_cards as ValuesCardData[]

  console.log("valuesCards", valuesCards)

  return valuesCards
}

export const seed = inngest.createFunction(
  { name: "Seed new case" },
  { event: "seed" },
  async ({ event, step }) => {
    const { caseId, question } = event.data

    const valuesCards = await step.run(
      "Generating seed values cards",
      async () => generateValuesCards(question)
    )

    const contexts = await step.run("Generating seed contexts", async () =>
      generateContexts(valuesCards)
    )

    /// TODO: replace with deduplicated card.
    await step.run("Adding values card to db", async () =>
      db.canonicalValuesCard.createMany({
        data: valuesCards.map((card) => ({
          title: card.title,
          instructionsShort: card.instructions_short,
          instructionsDetailed: card.instructions_detailed,
          evaluationCriteria: card.evaluation_criteria,
        })),
      })
    )

    await step.run("Adding contexts to db", async () =>
      db.context.createMany({
        data: contexts.map((context) => ({ id: context })),
      }),
    )

    await step.run("Adding contexts to case", async () =>
      db.contextsOnCases.createMany({
        data: contexts.map((contextId) => ({
          contextId: contextId,
          caseId: caseId,
        })),
      })
    )

    // Create new edges for the new values.
    await step.sendEvent({ name: "hypothesize", data: {} })

    return { message: "Done seeding new case." }
  }
)
