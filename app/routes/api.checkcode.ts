import { json, LoaderArgs } from "@remix-run/node";
import { auth } from "~/config.server";

export async function loader({ request }: LoaderArgs) {
    const url = new URL(request.url)
    const code = url.searchParams.get("c") ?? null;
    const role = await auth.checkCode(code);
    return json({role});
};
