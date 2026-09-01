import { z } from 'zod';
import { textResult, toolAnnotations, schemaConfirm } from '@chrischall/mcp-utils';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SimplePracticeClient } from '../client.js';
import { requestSignInLink, verifySignInPin, verifySignInToken } from '../auth.js';

export function registerAuthTools(server: McpServer, client: SimplePracticeClient): void {
  server.registerTool(
    'simplepractice_session_status',
    {
      description:
        'Report whether this server holds a Client Portal session, for which practice, and how that practice was determined (from a sign-in link, from SIMPLEPRACTICE_PRACTICE, or remembered from the stored session). Reads local state only — makes no network call.',
      annotations: toolAnnotations({ readOnly: true }),
      inputSchema: {},
    },
    async () => {
      const host = client.knownPortalHost();
      const session = client.getSession();
      return textResult({
        practiceHost: host,
        // Not knowing the practice yet is a state to report, not an error:
        // it is what a first run looks like before anyone has pasted a link.
        practiceSource: client.practiceSource(),
        signedIn: session !== null,
        signedInAt: session?.createdAt ?? null,
        ...(host
          ? {}
          : {
              next: 'Paste the sign-in link your provider emailed into simplepractice_verify_sign_in_token — its address names the practice. Or set SIMPLEPRACTICE_PRACTICE to pin this server to one.',
            }),
      });
    }
  );

  server.registerTool(
    'simplepractice_request_sign_in_link',
    {
      description:
        'Ask SimplePractice to email a sign-in link to a Client Portal address. The portal has no password — this is how you sign in. Sends a real email and is rate-limited per email address AND per IP, so it requires confirm:true. A success does not prove the address has an account: the API answers identically for unknown addresses by design.',
      annotations: toolAnnotations({ readOnly: false, idempotent: false }),
      inputSchema: {
        email: z.string().email().describe('The email address the Client Portal is registered to.'),
        practice: z
          .string()
          .min(1)
          .optional()
          .describe(
            'The practice whose portal to sign in to — the slug ("achievebalancetherapy"), the host, or the portal URL. Only needed when this server does not know the practice yet; signing in with an emailed link teaches it, and it then remembers.'
          ),
        confirm: schemaConfirm,
      },
    },
    async ({ email, practice, confirm }) => {
      // Adopted before the dry run too, so the preview names the practice the
      // email would actually come from.
      if (practice) client.adoptPracticeHost(practice);
      if (!confirm) {
        return textResult({
          dryRun: true,
          wouldSend: 'a Client Portal sign-in email',
          to: email,
          practiceHost: client.portalHost(),
          note: 'Re-run with confirm:true to actually send it. Do not retry a failed send — SimplePractice locks out repeated sign-in requests.',
        });
      }
      const { expiresIn } = await requestSignInLink(client, email);
      return textResult({
        sent: true,
        to: email,
        practiceHost: client.portalHost(),
        expiresIn,
        next: 'Open the email, copy the sign-in link (or just the part after the "#"), and pass it to simplepractice_verify_sign_in_token.',
        note: 'This response is the same whether or not the address has an account.',
      });
    }
  );

  server.registerTool(
    'simplepractice_verify_sign_in_token',
    {
      description:
        'Exchange an emailed sign-in link (or the token in it) for a Client Portal session. Accepts the whole link or just the part after the "#". Prefer passing the WHOLE link: its address names the practice, so no practice has to be configured, and this server remembers it afterwards. Tokens are single-use and last 24 hours.',
      annotations: toolAnnotations({ readOnly: false, idempotent: false }),
      inputSchema: {
        link: z
          .string()
          .min(1)
          .describe('The sign-in link from the email, or just the token after the "#".'),
      },
    },
    async ({ link }) => textResult(await verifySignInToken(client, link))
  );

  server.registerTool(
    'simplepractice_verify_sign_in_pin',
    {
      description:
        'Exchange a 6-digit Client Portal sign-in PIN for a session, for practices that email a code instead of a link. Single-use.',
      annotations: toolAnnotations({ readOnly: false, idempotent: false }),
      inputSchema: {
        email: z.string().email().describe('The address the PIN was sent to.'),
        pin: z.string().regex(/^\d{6}$/, 'The PIN is exactly 6 digits.'),
      },
    },
    async ({ email, pin }) => textResult(await verifySignInPin(client, email, pin))
  );

  server.registerTool(
    'simplepractice_sign_out',
    {
      description: 'Discard the stored Client Portal session from local state.',
      annotations: toolAnnotations({ readOnly: false, idempotent: true }),
      inputSchema: {},
    },
    async () => textResult({ signedOut: client.clearSession() })
  );
}
