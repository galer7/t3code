import type { ProjectId } from "@t3tools/contracts";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";

import {
  HostedPairingRouteSurface,
  PairingPendingSurface,
  PairingRouteSurface,
} from "../components/auth/PairingRouteSurface";
import { validateChatIndexSearch } from "../lib/chatIndexSearch";

export const Route = createFileRoute("/pair")({
  // `project` passes through to `/` once this browser is paired. Route search
  // also holds raw params such as `token`, so pass `project` on its own.
  validateSearch: validateChatIndexSearch,
  beforeLoad: async ({ context, search }) => {
    const { authGateState } = context;
    if (authGateState.status === "hosted-pairing") {
      return {
        authGateState,
      };
    }

    if (authGateState.status === "authenticated" || authGateState.status === "hosted-static") {
      throw redirect({ to: "/", search: indexSearch(search.project), replace: true });
    }
    return {
      authGateState,
    };
  },
  component: PairRouteView,
  pendingComponent: PairRoutePendingView,
});

function PairRouteView() {
  const router = useRouter();
  const { authGateState } = Route.useRouteContext();
  const { project } = Route.useSearch();

  if (!authGateState) {
    return null;
  }

  if (authGateState.status === "hosted-pairing") {
    return <HostedPairingRouteSurface />;
  }

  return (
    <PairingRouteSurface
      auth={authGateState.auth}
      onAuthenticated={() => {
        // Recreate the primary connection so its WebSocket and cached scopes
        // use the newly issued cookie after re-pairing.
        router.history.replace(
          router.buildLocation({ to: "/", search: indexSearch(project) }).href,
        );
        router.history.flush();
        window.location.reload();
      }}
      {...(authGateState.errorMessage ? { initialErrorMessage: authGateState.errorMessage } : {})}
    />
  );
}

function indexSearch(project: ProjectId | undefined) {
  return project === undefined ? {} : { project };
}

function PairRoutePendingView() {
  return <PairingPendingSurface />;
}
