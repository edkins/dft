import { auth, db, openai } from "~/config.server"
import { ActionArgs, ActionFunction, Response } from "@remix-run/node"
import { ValuesCardData } from "~/lib/consts"
import { ArticulatorService, MyEnrichedChunk } from "~/services/articulator"
import DeduplicationService from "~/services/deduplication"
import { Stream } from "openai/streaming"
import { ChatCompletionChunk } from "openai/resources"
// import { OpenAIStream, StreamingTextResponse } from "ai"

const deduplication = new DeduplicationService(openai, db)

async function createHeaders(
  articulatedCard?: ValuesCardData | null,
  submittedCard?: ValuesCardData | null
): Promise<{ [key: string]: string }> {
  const headers: { [key: string]: string } = {}

  if (articulatedCard) {
    headers["X-Articulated-Card"] = JSON.stringify(articulatedCard)
  }

  if (submittedCard) {
    headers["X-Submitted-Card"] = JSON.stringify(submittedCard)
  }

  return headers
}

export const config = {
  maxDuration: 300,
}

export const action: ActionFunction = async ({
  request,
}: ActionArgs): Promise<Response> => {
  const articulatorConfig = process.env.ARTICULATOR_CONFIG ?? "default"
  const userId = await auth.getUserId(request)
  if (userId === null) {
    throw new Error("No user id")
  }
  const json = await request.json()

  const { messages, chatId, caseId, function_call } = json

  // Create stream for next chat message.
  const articulator = new ArticulatorService(
    articulatorConfig,
    deduplication,
    openai,
    db
  )
  const { completionResponse, ...etc } =
    await articulator.processCompletionWithFunctions({
      userId,
      messages,
      function_call,
      chatId,
      caseId,
    })

  // if (etc.functionCall) {
  //   // If a function call is present in the stream, handle it...
  //   return streaming_text_response(
  //     etc.response,
  //     await createHeaders(etc.articulatedCard, etc.submittedCard),
  //   )
  // } else {
    // ...otherwise, return the response.
    return await streaming_text_response(completionResponse!)
  //}
}

async function streaming_text_response(stream: Stream<MyEnrichedChunk>): Promise<Response> {
  let iter = stream[Symbol.asyncIterator]();
  const encoder = new TextEncoder();

  let initialChunk = await iter.next();
  const headers = await createHeaders(initialChunk.value.articulatedCard, initialChunk.value.submittedCard);

  const readableStream = new ReadableStream({
    async start() {},
    async pull(ctrl: any) {
      try {
        const { value, done } = await iter.next();
        if (done && initialChunk.done) return ctrl.close();

        let initial_content = '';
        if (!initialChunk.done) {
          initial_content = initialChunk.value.chunk_content;
          initialChunk.done = true as any;
        }
        const chunk_content = value?.chunk_content || '';
        const bytes = encoder.encode(initial_content + chunk_content);
        ctrl.enqueue(bytes);
      } catch (err) {
        ctrl.error(err);
      }
    },
    async cancel() {
      await iter.return?.();
    },
  });

  return new Response(readableStream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...headers,
    },
  })
}