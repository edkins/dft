import { Form, useActionData, useSearchParams } from "@remix-run/react";
import { auth } from "~/config.server";
import { useEffect, useState } from "react";
import { ExternalLink } from "~/components/external-link";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ActionArgs, json } from "@remix-run/node";
import { Button } from "~/components/ui/button";
import va from "@vercel/analytics";
import { Loader2 } from "lucide-react";

export async function action(args: ActionArgs) {
  try {
    return await auth.registerUserFromInvitation(args)
  } catch (error: any) {
    // Handle errors in client.
    return json({ error: error.message }, { status: 500 })
  }
}

export default function InviteScreen() {
  const [searchParams] = useSearchParams()
  const [isLoading, setIsLoading] = useState(false)
  const [showError, setShowError] = useState(false)
  const [name, setName] = useState<string>("")
  const actionData = useActionData<typeof action>()

  const redirect = searchParams.get("redirect") as string

  useEffect(() => {
    if (actionData && actionData?.status !== 200) {
      setShowError(true)
      setIsLoading(false)
      setName("")

      const timeout = setTimeout(() => setShowError(false), 5_000)
      return () => {
        clearTimeout(timeout)
      }
    }
  }, [actionData])

  return (
    <div className="grid h-screen place-items-center p-8">
      <div className="mx-auto flex w-full flex-col justify-center space-y-6 max-w-sm">
        <div className="flex flex-col space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Get Started</h1>
          <p className="text-sm text-muted-foreground">
            You have been invited to join Democratic Fine-Tuning
          </p>
        </div>
        <div className="grid gap-6">
          <Form method="post" onSubmit={() => setIsLoading(true)}>
            <input type="hidden" name="redirect" value={redirect || ""} />
            <input type="hidden" name="autoregister" value="YES" />
            <div className="grid gap-2">
              <div className="grid gap-1">
                <Label className="sr-only" htmlFor="name">
                  Name
                </Label>
                <Input
                  id="name"
                  placeholder="yourname"
                  name="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  disabled={isLoading}
                />
              </div>

              <Button
                disabled={isLoading}
                type="submit"
                onClick={() => va.track("Invitation Sign Up Clicked")}
              >
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Sign Up
              </Button>
            </div>
          </Form>
        </div>

        <p className="text-center text-sm text-muted-foreground">
          Hosted by <ExternalLink href="https://www.meetup.com/toronto-ai-aligners/">Toronto AI Safety Meetup</ExternalLink>
        </p>
        <p className="text-center text-sm text-muted-foreground">
          Built by the{" "}
          <ExternalLink href="https://meaningalignment.org">
            Institute for Meaning Alignment
          </ExternalLink>
          .
        </p>
        <div
          className={`mt-6 w-full text-center transition-opacity duration-300 ease-in-out ${showError ? "opacity-100" : "opacity-0"
            }`}
        >
          <div className="text-red-500">{actionData?.error ?? "error"}</div>
        </div>
      </div>
    </div>
  )
}