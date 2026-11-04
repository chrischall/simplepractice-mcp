import { z } from 'zod';
import { isCompact, viewArgWithBrief } from '../view.js';
import { briefLine, briefResult, healthMeta, oneLine } from '../hints.js';
import { minifiedResult, toolAnnotations } from '@chrischall/mcp-utils';
import type { McpServer } from '@modelcontextprotocol/server';
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

/**
 * One appointment as one brief line: `<service> with <clinician> — <start> —
 * <status>`. The status is the practice's own confirmation status where the
 * record carries one, else which side of the pending-confirmation filter was
 * read ("scheduled" or "requested").
 */
function briefAppointment(a: Record<string, unknown>, status: 'scheduled' | 'requested'): string {
  const c = compactAppointment(a);
  const service = oneLine(c.service) ?? 'Appointment';
  const clinician = oneLine(c.clinician);
  const title = clinician ? `${service} with ${clinician}` : service;
  const shown = status === 'requested' ? 'requested' : (oneLine(c.confirmationStatus) ?? status);
  return briefLine(title, oneLine(c.startTime), shown);
}

export function registerAppointmentTools(server: McpServer, client: SimplePracticeClient): void {
  server.registerTool(
    'simplepractice_list_appointments',
    {
      description:
        'Appointments from the Client Portal. status "scheduled" returns confirmed/upcoming ones; "requested" returns those still awaiting the practice\'s confirmation. Pages by number.',
      annotations: toolAnnotations({ readOnly: true, openWorld: true }),
      _meta: healthMeta('whats-on', {
        canonical: true,
        aliases: ['therapy', 'therapist', 'counseling', 'appointment', 'next session', 'telehealth'],
      }),
      inputSchema: z.object({
        status: z
          .enum(['scheduled', 'requested'])
          .default('scheduled')
          .describe('Which side of the pending-confirmation filter to read.'),
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().positive().max(PAGE_SIZE_MAX).default(PAGE_SIZE_MAX),
        view: viewArgWithBrief(),
      }),
    },
    async ({ status, page, pageSize, view }) => {
      const { records } = await client.list('/appointments', {
        include: 'clinician,office,client',
        filter: { hasPendingConfirmation: status === 'requested' },
        page: { number: page, size: pageSize },
      });
      if (view === 'brief') return briefResult(records.map((a) => briefAppointment(a, status)));
      return minifiedResult({
        status,
        page,
        count: records.length,
        // The API sends no total; a short page is the last page.
        hasMore: records.length >= pageSize,
        appointments: isCompact(view) ? records.map(compactAppointment) : records,
      });
    }
  );
}
