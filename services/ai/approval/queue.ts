// Human approval queue.
//
// For Level 4 (and any SHIELD ESCALATE), the router MUST NOT auto-release. It
// enqueues an approval item and returns status 'pending_human_approval' with a
// safe holding message. A licensed human resolves it out of band.
//
// PRODUCTION MAPPING (reuse-and-extend, decision #2): the default in-memory
// queue is replaced by an adapter that writes to the EXISTING REBUILD tables
// `advisor_transfer_queue` (routing to a licensed agent) and/or
// `compliance_review_queue`. The interface is identical so the router is
// unchanged.

import type {
  Classification,
  DecisionOutput,
  ComparisonResult,
  ShieldReview,
} from '../types.ts'

export interface ApprovalItem {
  requestId: string
  agent: string
  taskType: string
  classification: Classification
  candidateResponse: string
  decision: DecisionOutput | null
  comparison: ComparisonResult | null
  shield: ShieldReview | null
  reason: string
  createdAt: number
}

export interface HumanApprovalQueue {
  /** Persist the item; returns an approval id the caller surfaces to ops. */
  enqueue(item: ApprovalItem): Promise<string>
}

/** Deterministic default: stores items in memory, ids are derived (no RNG). */
export class InMemoryApprovalQueue implements HumanApprovalQueue {
  readonly items: ApprovalItem[] = []
  private seq = 0

  // eslint-disable-next-line @typescript-eslint/require-await
  async enqueue(item: ApprovalItem): Promise<string> {
    this.seq += 1
    this.items.push(item)
    return `approval-${item.requestId}-${this.seq}`
  }
}
