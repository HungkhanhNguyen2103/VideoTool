import { monotonicFactory } from 'ulid';

// Monotonic: ids created in the same millisecond still sort in creation order.
const nextUlid = monotonicFactory();

/** New string id used as `_id` of every document (never an ObjectId). */
export function newId(): string {
  return nextUlid();
}
