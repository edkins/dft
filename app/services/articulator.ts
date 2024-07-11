import { OpenAI } from "openai"
import { ChatCompletionChunk, ChatCompletionMessage } from "openai/resources"
import { Chat, PrismaClient, ValuesCard } from "@prisma/client"
import {
  ArticulatorConfig,
  metadata,
  summarize,
} from "../values-tools/articulator-config"
import { ValuesCardData } from "~/lib/consts"
import { capitalize, isDisplayableMessage, toDataModel } from "~/utils"
import { embeddingService as embeddings } from "../values-tools/embedding"
import DeduplicationService from "./deduplication"
import { articulatorConfigs } from "~/config.server"
import { Stream } from "openai/streaming"

// import { OpenAIStream, StreamingTextResponse } from "ai"   //TODO replace the above import with this once https://github.com/vercel-labs/ai/issues/199 is fixed.

type ArticulateCardResponse = {
  values_card: ValuesCardData
  critique?: string | null
}

type FunctionResult = {
  message: string | null
  articulatedCard: ValuesCardData | null
  submittedCard: ValuesCardData | null
}

export function normalizeMessage(
  message: ChatCompletionMessage
): ChatCompletionMessage {
  // only role, content, name, tool_calls
  const { role, content, tool_calls, tool_call_id } = message
  //if (function_call && !function_call.arguments) function_call.arguments = "{}"
  return { role, content, tool_calls, tool_call_id }
}

/**
 * A service for handling function calls in the chat.
 */
export class ArticulatorService {
  private deduplication: DeduplicationService
  private openai: OpenAI
  private db: PrismaClient
  public config: ArticulatorConfig

  constructor(
    configKey: string,
    deduplication: DeduplicationService,
    openai: OpenAI,
    db: PrismaClient
  ) {
    this.config = articulatorConfigs[configKey]
    this.deduplication = deduplication
    this.openai = openai
    this.db = db
  }

  metadata() {
    return metadata(this.config)
  }

  // TODO: put it in a transaction
  private async addServerSideMessage({
    chatId,
    messages,
    message,
    data,
  }: {
    chatId: string
    messages: ChatCompletionMessage[]
    message: ChatCompletionMessage
    data?: {
      provisionalCard?: ValuesCardData
      provisionalCanonicalCardId?: number | null
    }
  }) {
    messages.push(message)
    const chat = await this.db.chat.findUnique({
      where: { id: chatId },
    })
    const transcript = (chat?.transcript ??
      []) as any as ChatCompletionMessage[]
    console.log("I'm addServerSideMessage and I'm pushing a message to the transcript");
    console.log(message);
    //console.log(`The last message was ${transcript[transcript.length - 1].content}`);
    transcript.push(message)
    await this.db.chat.update({
      where: { id: chatId },
      data: {
        transcript: transcript as any,
        ...data,
      },
    })
  }

  async processCompletionWithFunctions({
    userId,
    messages,
    function_call,
    chatId,
    caseId,
  }: {
    userId: number
    messages: ChatCompletionMessage[]
    function_call: { name: string } | null
    chatId: string
    caseId: string
  }) {
    // update the db
    // TODO: put it in a transaction
    const chat = await this.db.chat.findUnique({ where: { id: chatId } })
    if (chat) {
      const transcript = (chat?.transcript ??
        []) as any as ChatCompletionMessage[]
      const lastMessage = messages[messages.length - 1]
      console.log("I'm pushing a message to the transcript");
      console.log(lastMessage);
      console.log(`The last message was ${transcript[transcript.length - 1].content}`);
      transcript.push(lastMessage)
      messages = transcript.map((o) => normalizeMessage(o))
      await this.db.chat.update({
        where: { id: chatId },
        data: {
          transcript: transcript as any,
        },
      })
    } else {
      const metadata = this.metadata()
      // Prepend the system message.
      messages = [
        { role: "system", content: this.config.prompts.main.prompt },
        ...messages,
      ]
      await this.db.chat.create({
        data: {
          userId,
          caseId,
          id: chatId,
          transcript: messages as any,
          articulatorModel: metadata.model,
          articulatorPromptHash: metadata.contentHash,
          articulatorPromptVersion: metadata.name,
          gitCommitHash: metadata.gitHash,
        },
      })
    }

    // Only include the submit function if a card has already been articulated and shown to the user.
    // This prevents submit from being called before the user has articulated a card, which causes an error.
    let functions = this.config.prompts.main.functions
    if (chat && !chat.provisionalCard) {
      functions = functions.filter((f) => f.name !== "submit_values_card")
    }

    const response = await this.openai.chat.completions.create({
      model: this.config.model,
      messages: messages,
      temperature: 0.7,
      stream: true,
      tools: functions.map((f) => ({type:'function',function:f})),
      tool_choice: function_call ? {type:'function',function:function_call} : "auto",
    })

    const completionResponse = this.add_text_to_db_and_handle_functions(chatId, messages, response);

    return {completionResponse};

    // const [response0, response1] = completionResponse.tee();

    // // Get any function call that is present in the stream.
    // const functionCall = await this.getFunctionCall(response0)
    // if (!functionCall) return { completionResponse: response1 }

    // // If a function call is present in the stream, handle it...
    // await this.addServerSideMessage({
    //   chatId,
    //   messages,
    //   message: {
    //     role: "assistant",
    //     content: null as any,
    //     function_call: {
    //       name: functionCall.name,
    //       arguments: JSON.stringify(functionCall.arguments),
    //     },
    //   },
    // })

    // const { response, articulatedCard, submittedCard } = await this.handle(
    //   functionCall,
    //   messages,
    //   chatId,
    //   caseId
    // )
    // return {
    //   functionCall,
    //   response,
    //   articulatedCard,
    //   submittedCard,
    //   completionResponse: response1,
    // }
  }

  add_text_to_db_and_handle_functions(
      chatId: string,
      messages: any,
      stream: Stream<ChatCompletionChunk>
    ): Stream<ChatCompletionChunk> {
      const parent = this;
      async function* iterator(): AsyncIterator<ChatCompletionChunk, any, undefined> {
        let content = '';
        let call_id = undefined;
        let function_name = undefined;
        let args = '';
        for await (const chunk of stream) {
          //console.log('chunk', chunk.choices[0].delta);
          const chunk_content = chunk.choices[0].delta.content;
          if (chunk_content !== undefined && chunk_content !== null) {
            content += chunk_content;
          }
          if (chunk.choices[0].delta.tool_calls !== undefined) {
            const tc = chunk.choices[0].delta.tool_calls[0];
            if (tc.id !== undefined) call_id = tc.id;
            if (tc.function?.name !== undefined) function_name = tc.function.name;
            if (tc.function?.arguments !== undefined) args += tc.function.arguments
          }

          yield chunk;
        }
        if (function_name === undefined) {
          await parent.addServerSideMessage({
            chatId,
            messages,
            message: {role: 'assistant', content, tool_calls: undefined},
          });
        } else {
          let functionCall = {name: function_name, arguments: args};
          await parent.addServerSideMessage({
            chatId,
            messages,
            message: {role: 'assistant', content, tool_calls: [{
              type: 'function',
              id: call_id!,
              function: functionCall
            }]},
          });
          await parent.handle(
            functionCall,
            messages,
            chatId,
            call_id,
          );
        }
  }
      return new Stream(iterator, stream.controller);
  }

  //
  // Vercel AI openai functions handling is broken in Remix. The `experimental_onFunctionCall` provided by the `ai` package does not work.
  //
  // We have to handle them manually, until https://github.com/vercel-labs/ai/issues/199 is fixed.
  // This is done by listening to the first token and seeing if it is a function call.
  // If so, wait for the whole response and handle the function call.
  // Otherwise, return the stream as-is.
  //
  // async getFunctionCall(
  //   stream: Stream<ChatCompletionChunk>
  // ): Promise<{ name: string; arguments: object } | null> {
  //   for await (const obj of stream) {
  //     if (obj.choices[0].delta.tool_calls)
  //   }

  //   const isFunctionCall = first
  //     ?.replace(/[^a-zA-Z0-9_]/g, "")
  //     ?.startsWith("function_call")

  //   if (!isFunctionCall) {
  //     return null
  //   }

  //   //
  //   // Function arguments are streamed as tokens, so we need to
  //   // read the whole stream, concatenate the tokens, and parse the resulting JSON.
  //   //
  //   let result = first

  //   while (true) {
  //     const { done, value } = await reader.read()

  //     if (done) {
  //       break
  //     }

  //     result += value
  //   }

  //   //
  //   // Return the resulting function call.
  //   //
  //   const json = JSON.parse(result)["function_call"]
  //   console.log(`Function call: ${JSON.stringify(json)}`)

  //   // The following is needed due to tokens being streamed with escape characters.
  //   json["arguments"] = JSON.parse(json["arguments"])
  //   console.log(`Function call: ${JSON.stringify(json)}`)
  //   return json as { name: string; arguments: object }
  // }

  private async handleArticulateCardFunction(
    chatId: string,
    messages: ChatCompletionMessage[]
  ): Promise<FunctionResult> {
    console.log("Articulating card for chat " + chatId)
    //
    // Fetch the chat with the provisional card from the database.
    //
    const chat = (await this.db.chat.findUnique({
      where: { id: chatId },
    })) as Chat

    const previousCard = chat.provisionalCard
      ? (chat.provisionalCard as ValuesCardData)
      : null

    console.log(
      `Previous card for chat ${chatId}: ${JSON.stringify(previousCard)}`
    )

    // Articulate the values card.
    const response = await this.articulateValuesCard(messages, previousCard)

    console.log(
      `Articulated card for chat ${chatId}: ${JSON.stringify(response)}`
    )

    // The newly articulated card.
    let newCard = response.values_card

    //
    // If the card is not yet meeting the guidelines, generate a follow-up question.
    //
    if (response.critique) {
      const message = summarize(this.config, "show_values_card_critique", {
        critique: response.critique,
      })

      await this.addServerSideMessage({
        chatId,
        messages,
        message: {
          role: "function",
          name: "show_values_card",
          content: JSON.stringify(newCard),
        },
        data: { provisionalCard: newCard! },
      })

      return {
        message,
        articulatedCard: null,
        submittedCard: null,
      }
    }

    //
    // Override the card with a canonical duplicate if one exists.
    //
    // Only do this the first time the articulate function is called,
    // since subsequent calls mean the user is revising the card.
    //
    let provisionalCanonicalCardId: number | null = null

    if (
      !previousCard &&
      !chat.provisionalCanonicalCardId &&
      !response.critique
    ) {
      let canonical = await this.deduplication.fetchSimilarCanonicalCard(
        response.values_card
      )

      if (canonical) {
        provisionalCanonicalCardId = canonical.id
        console.log(`Found duplicate ${canonical.id} for chat ${chatId}`)
        newCard = toDataModel(canonical)
      }
    }

    await this.addServerSideMessage({
      chatId,
      messages,
      message: {
        role: "function",
        name: "show_values_card",
        content: JSON.stringify(newCard),
      },
      data: {
        provisionalCard: newCard!,
        provisionalCanonicalCardId,
      },
    })

    const message = summarize(this.config, "show_values_card", {
      title: newCard!.title,
    })

    return { message, articulatedCard: newCard, submittedCard: null }
  }

  private async handleSubmitCardFunction(
    chatId: string
  ): Promise<FunctionResult> {
    const chat = (await this.db.chat.findUnique({
      where: { id: chatId },
    })) as Chat

    const card = chat.provisionalCard as ValuesCardData

    // Submit the values card.
    const message = await this.submitValuesCard(
      card,
      chatId,
      chat.provisionalCanonicalCardId
    )

    return { message, submittedCard: card, articulatedCard: null }
  }

  async handle(
    func: { name: string; arguments: any },
    messages: any[] = [],
    chatId: string,
    tool_call_id: string,
  ): Promise<undefined> {
    let functionResult: FunctionResult

    if (tool_call_id === null || tool_call_id === undefined) {
      throw new Error("Tool call ID is null or undefined.")
    }

    console.log(`Handling function call ${func.name} for chat ${chatId}`)

    switch (func.name) {
      case "guess_values_card": {
        console.log("Guessed!", func.arguments)
        functionResult = {
          message: '',
          articulatedCard: null,
          submittedCard: null,
        }
        break
      }
      case "show_values_card": {
        console.log("Calling show_values_card...")
        functionResult = await this.handleArticulateCardFunction(
          chatId,
          messages
        )
        break
      }
      case "submit_values_card": {
        console.log("Calling submit_values_card...")
        functionResult = await this.handleSubmitCardFunction(chatId)
        break
      }
      default: {
        throw new Error("Unknown function call: " + func.name)
      }
    }

    if (functionResult.message === undefined) {
      throw new Error("Function result message is undefined.")
    }
    console.log(`Result from "${func.name}":\n${functionResult.message}`)

    await this.addServerSideMessage({
      chatId,
      messages,
      message: {
        role: "tool",
        tool_call_id,
        content: functionResult.message,
      },
    })

    //
    // Call the OpenAI API with the function result.
    //
    // This wraps the raw function result in a generated message that fits the flow
    // of the conversation.
    //

    // console.log(`Calling OpenAI API with function result...`)
    // console.log(`Messages:\n${JSON.stringify(messages)}`)

    // const response = await this.openai.chat.completions.create({
    //   model: this.config.model,
    //   messages,
    //   temperature: 0.0,
    //   functions: this.config.prompts.main.functions,
    //   function_call: "none", // Prevent recursion.
    //   stream: true,
    // })

    // return { response, ...functionResult }
  }

  async submitValuesCard(
    card: ValuesCardData,
    chatId: string,
    canonicalCardId: number | null
  ): Promise<string> {
    console.log(
      `Submitting values card:\n\n${JSON.stringify(card)} for chat ${chatId}`
    )

    const data = {
      title: card.title,
      instructionsShort: card.instructions_short,
      instructionsDetailed: card.instructions_detailed,
      evaluationCriteria: card.evaluation_criteria,
      chatId,
      canonicalCardId: canonicalCardId ?? null,
    }

    // Save the card in the database.
    const result = (await this.db.valuesCard
      .upsert({
        where: { chatId },
        create: { ...data },
        update: { ...data },
      })
      .catch((e) => console.error(e))) as ValuesCard

    // Embed card.
    await embeddings.embedNonCanonicalCard(result)
    return summarize(this.config, "submit_values_card", { title: card.title })
  }

  /** Create a values card from a transcript of the conversation. */
  async articulateValuesCard(
    messages: ChatCompletionMessage[],
    previousCard: ValuesCardData | null
  ): Promise<ArticulateCardResponse> {
    console.log("Articulating values card...")

    let transcript =
      "Transcript:\n\n" +
      messages
        .filter(
          (m) =>
            isDisplayableMessage(m) ||
            (m.name === "show_values_card" && m.content)
        )
        .map((m) => `${capitalize(m.role)}: ${m.content}`)
        .join("\n")

    if (previousCard) {
      transcript += `\n\nArticulate new, revised card based on: ${JSON.stringify(
        previousCard
      )}`
    }

    console.log("Calling articulation prompt...")

    let data = undefined;

    try {
      data = await this.openai.chat.completions.create({
        model: this.config.model,
        messages: [
          {
            role: "system",
            content: this.config.prompts.show_values_card.prompt,
          },
          { role: "user", content: transcript },
        ],
        tools: this.config.prompts.show_values_card.functions.map(f => ({type:'function',function:f})),
        tool_choice: {type: 'function', function: { name: "format_card" }},
        temperature: 0.0,
        stream: false,
      })
    } catch (e) {
      console.log("Error calling articulation prompt: " + e)
      console.error(e)
      throw e
    }

    console.log("Got response from articulation prompt, parsing...")

    const response = JSON.parse(
      data.choices[0].message.tool_calls![0].function.arguments
    ) as ArticulateCardResponse

    console.log(
      `Parsed response from articulation prompt: ${JSON.stringify(response)}`
    )

    return response
  }
}
