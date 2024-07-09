import { Form, useActionData, useSearchParams } from "@remix-run/react";
import { auth } from "~/config.server";
import { useEffect, useState } from "react";
import { ExternalLink } from "~/components/external-link";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ActionArgs, json, redirect } from "@remix-run/node/dist";
import { Button } from "~/components/ui/button";
import va from "@vercel/analytics";
import { Loader2 } from "lucide-react";

export async function action(args: ActionArgs) {
  try {
    const data = await args.request.formData();
    const name = data.get('name') as string;
    const code = new URL(args.request.url).searchParams.get('c') as string;
    const user = await auth.registerUserFromInvitation({name, code});
    return auth.redirectAsLoggedIn(args.request, user);
  } catch (error: any) {
    // Handle errors in client.
    return json({ error: error.message }, { status: 500 })
  }
}

export default function InviteScreen() {
  const [searchParams] = useSearchParams()
  const [isLoading, setIsLoading] = useState(true)
  const [showError, setShowError] = useState(false)
  const [name, setName] = useState<string>("")
  const actionData = useActionData<typeof action>()
  const code = searchParams.get("c");
  const [role, setRole] = useState<string>("UNKNOWN");

  useEffect(() => {
    if (code === null || !/^[a-zA-Z0-9]{20}$/.test(code)) {
      setRole("INVALID");
      setIsLoading(false);
    } else {
      fetch(`/api/checkcode?c=${code}`).then(async (res) => {
        if (res.status === 200) {
          const { role } = await res.json();
          setRole(role);
        } else {
          setRole("INVALID");
        }
        setIsLoading(false);
      });
    }
  }, [code]);

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
  }, [actionData]);

  return (
    <div className="grid h-screen place-items-center p-8">
      <div className="mx-auto flex w-full flex-col justify-center space-y-6 max-w-sm">
        <div className="flex flex-col space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Get Started</h1>
          <p className="text-sm text-muted-foreground">
          { role === 'USER' ?
              <>You have been invited to join Democratic Fine-Tuning</>
            : role === 'ADMIN' ?
            <>You have been invited to join Democratic Fine-Tuning as an Admin</>
            : role === 'INVALID' ?
            <>Invalid invite link</>
            : role === 'EXPIRED' ?
            <>Invite link expired</>
            :
              <>Checking invite</>
          }
          </p>
        </div>
        <div className="grid gap-6">
          <Form method="post" onSubmit={() => setIsLoading(true)}>
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