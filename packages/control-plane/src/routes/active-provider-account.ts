import { isCanonicalUserId } from "@open-inspect/shared/user-id";
import type { SubscriptionProviderId } from "@open-inspect/shared/types/provider-accounts";
import { ModelProviderAccountStore } from "../db/model-provider-accounts";
import { ProviderDefaultStore } from "../db/provider-account-defaults";
import { activePromptAuthorSchema } from "../session/active-prompt-author";
import { SessionInternalPaths } from "../session/contracts";
import { createSessionRuntimeClient } from "../session/runtime-client";
import type { Env } from "../types";
import { error, type SandboxRouteContext } from "./shared";

/** Resolve at issuance, not at session creation: collaborators spend their own account. */
export async function activePromptProviderAccount(
  env: Env,
  ctx: SandboxRouteContext,
  sessionId: string,
  provider: SubscriptionProviderId
): Promise<string | Response> {
  const response = await createSessionRuntimeClient(env, ctx).fetch(
    sessionId,
    SessionInternalPaths.activePromptAuthor
  );
  if (!response.ok) return error("No active prompt author", 409);
  const parsed = activePromptAuthorSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return error("Active prompt author unavailable", 503);
  const ownerUserId = parsed.data.canonicalUserId ?? parsed.data.userId;
  if (!isCanonicalUserId(ownerUserId)) {
    return error("Active prompt has no connected account owner", 409);
  }

  const accounts = new ModelProviderAccountStore(ctx.db);
  const configured = await new ProviderDefaultStore(ctx.db).get(ownerUserId, provider);
  if (configured) {
    const account = await accounts.getById(configured.providerAccountId);
    if (
      (await accounts.getOwnerId(configured.providerAccountId)) !== ownerUserId ||
      account?.provider !== provider ||
      account.status !== "active" ||
      account.archivedAt !== null
    ) {
      return error("Your connected provider account is unavailable", 409);
    }
    return account.id;
  }

  const active = (await accounts.listForOwner(ownerUserId, provider)).filter(
    (account) => account.status === "active"
  );
  if (active.length === 1) return active[0].id;
  if (active.length > 1) return error("Choose a default for your provider accounts", 409);
  return error(`Connect your own ${provider} account to prompt this session`, 409);
}
