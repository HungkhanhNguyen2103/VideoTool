import { JobSummarySchema, type JobSummary } from '../../contracts/job';
import { apiRequest } from './api-client';

export function cancelJob(jobId: string): Promise<JobSummary> {
  return apiRequest(`/api/job/${encodeURIComponent(jobId)}/cancel`, JobSummarySchema, { method: 'POST' });
}
