import { z } from 'zod';
import { textResult, toolAnnotations } from '@chrischall/mcp-utils';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SimplePracticeClient } from '../client.js';

const PAGE_SIZE_MAX = 50;

function compactAppointment(a: Record<string, unknown>) {
  const clinician = a.clinician as Record<string, unknown> | undefined;
  const office = a.office as Record<string, unknown> | undefined;
  return {
    id: a.id,
    startTime: a.startTime,
    endTime: a.endTime,
    service: a.serviceDescription,
    clinician: clinician && [clinician.firstName, clinician.lastName].filter(Boolean).join(' '),
    location: office?.isVideo
      ? 'telehealth'
      : office && [office.name, office.city, office.state].filter(Boolean).join(', '),
    videoRoomUrl: a.videoRoomUrl,
    confirmationStatus: a.confirmationStatus,
    clientConfirmationStatus: a.clientConfirmationStatus,
    isCancellable: a.isCancellable,
    fee: a.fee,
  };
}

export function registerAppointmentTools(server: McpServer, client: SimplePracticeClient): void {
  server.registerTool(
    'simplepractice_list_appointments',
    {
      description:
        'Appointments from the Client Portal. status "scheduled" returns confirmed/upcoming ones; "requested" returns those still awaiting the practice\'s confirmation. Pages by number.',
      annotations: toolAnnotations({ readOnly: true }),
      inputSchema: {
        status: z
          .enum(['scheduled', 'requested'])
          .default('scheduled')
          .describe('Which side of the pending-confirmation filter to read.'),
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().positive().max(PAGE_SIZE_MAX).default(PAGE_SIZE_MAX),
        compact: z
          .boolean()
          .default(true)
          .describe('Return a slim projection. Set false for the full records.'),
      },
    },
    async ({ status, page, pageSize, compact }) => {
      const { records } = await client.list('/appointments', {
        include: 'clinician,office,client',
        filter: { hasPendingConfirmation: status === 'requested' },
        page: { number: page, size: pageSize },
      });
      return textResult({
        status,
        page,
        count: records.length,
        // The API sends no total; a short page is the last page.
        hasMore: records.length >= pageSize,
        appointments: compact ? records.map(compactAppointment) : records,
      });
    }
  );
}
