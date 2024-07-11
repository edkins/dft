import { auth, db, openai } from "~/config.server"
import { ActionArgs, ActionFunction, Response } from "@remix-run/node"
import { ValuesCardData } from "~/lib/consts"
import { ArticulatorService } from "~/services/articulator"
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

  if (etc.functionCall) {
    // If a function call is present in the stream, handle it...
    return streaming_text_response(
      etc.response,
      await createHeaders(etc.articulatedCard, etc.submittedCard),
    )
  } else {
    // ...otherwise, return the response.
    return streaming_text_response(
      completionResponse!,
      await createHeaders(),
    )
  }
}

function streaming_text_response(stream: Stream<ChatCompletionChunk>, headers: { [key: string]: string }) {
  return new Response(to_readable_stream_text_only(stream), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...headers,
    },
  })
}

function to_readable_stream_text_only(stream: Stream<ChatCompletionChunk>): ReadableStream {
  let iter: AsyncIterator<ChatCompletionChunk>;
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start() {
      console.log("Starting stream");
      console.log(stream[Symbol.asyncIterator]);
      iter = stream[Symbol.asyncIterator]();
    },
    async pull(ctrl: any) {
      try {
        const { value, done } = await iter.next();
        if (done) return ctrl.close();

        if (value.choices[0].delta.content !== null && value.choices[0].delta.content !== undefined) {
          const bytes = encoder.encode(value.choices[0].delta.content!);
          ctrl.enqueue(bytes);
        }
      } catch (err) {
        ctrl.error(err);
      }
    },
    async cancel() {
      await iter.return?.();
    },
  });
}