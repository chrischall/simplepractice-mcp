import { minifiedResult, toolAnnotations } from '@chrischall/mcp-utils';
import { parseJsonString } from '../jsonapi.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SimplePracticeClient } from '../client.js';

/**
 * No `view` here, deliberately.
 *
 * `simplepractice_get_account` returns a hand-written projection: every field
 * on it is picked by name out of `/environment`, chosen WITH knowledge of the
 * payload (which is why `clientMayCancelAppointments` and the parsed
 * `permissions` string are on it at all). There is no un-projected upstream
 * shape left for a blind media-strip to act on, so a `view` parameter here
 * would be one that changes nothing — worse than none.
 */
export function registerAccountTools(server: McpServer, client: SimplePracticeClient): void {
  server.registerTool(
    'simplepractice_get_account',
    {
      description:
        'The practice, the signed-in client, and every client this login can see. One portal login is a "client access" and may cover more than one client — a parent seeing two children, say — so clients is always a list.',
      annotations: toolAnnotations({ readOnly: true }),
      inputSchema: {},
    },
    async () => {
      const { records } = await client.list('/environment', {
        include: 'currentPractice,currentClient,currentClientOptions,currentClientAccess',
      });
      const environment = records[0] ?? {};
      const practice = environment.currentPractice as Record<string, unknown> | undefined;
      const currentClient = environment.currentClient as Record<string, unknown> | undefined;
      const options = (environment.currentClientOptions as Array<Record<string, unknown>>) ?? [];

      // Only ever called with a resolved client record, so no undefined guard.
      const name = (c: Record<string, unknown>) =>
        [c.preferredName ?? c.firstName, c.lastName].filter(Boolean).join(' ');

      return minifiedResult({
        practice: practice && {
          id: practice.id,
          name: practice.fullName,
          timeZone: practice.timeZone,
          phone: practice.phoneNumber,
          currency: practice.currency,
          isGroupPractice: practice.isGroupPractice,
          telehealthEnabled: practice.telehealthEnabled,
          selfSchedulingEnabled: practice.selfSchedulingEnabled,
          // The practice's actual cancellation policy — read this before
          // telling anyone an appointment can be cancelled.
          clientMayCancelAppointments: practice.isClientAllowedToCancelAppt,
          clientMayConfirmAppointments: practice.isClientAllowedToConfirmAppt,
          cancellationNoticeHours: practice.clientCancellableHrs,
        },
        currentClient: currentClient && {
          id: currentClient.id,
          name: name(currentClient),
          status: currentClient.status,
          hasIncompleteDocument: currentClient.hasIncompleteDocument,
          hasNewAnnouncements: currentClient.hasNewAnnouncements,
          // Sent as a JSON *string*, not an object — and it decides which
          // portal features this client actually has, so a caller that reads
          // it raw gets a string of characters instead of the flags.
          permissions: parseJsonString(currentClient.permissions),
        },
        clients: options.map((c) => ({ id: c.id, name: name(c) })),
      });
    }
  );
}
